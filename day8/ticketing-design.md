# TicketHub: Event Ticketing System Design

## 1. Requirements

### Functional requirements

- Visitors can browse and search events, view event details, and see seat availability and prices.
- A signed-in customer can temporarily hold an available seat, complete payment, and view or cancel eligible orders.
- A customer receives a confirmed ticket only after payment succeeds and the seat is atomically marked sold.
- Staff can create events, configure seating and prices, and inspect sales.
- Customers can view only their own orders; staff actions require appropriate authorization.

### Non-functional requirements

- **Correctness:** Never confirm or charge two customers for the same event seat; payment retries must be idempotent.
- **Fairness:** Sale access should use a published queue or rate-limited admission policy, with queue tokens that preserve arrival order and prevent clients from bypassing the queue by repeatedly refreshing.
- **Speed:** Keep event browsing responsive through caching; provide fast feedback for seat selection and clear waiting/hold-expiration status during high-demand sales.
- **Availability:** Keep browsing and queue status available through individual instance or zone failures; degrade gracefully rather than oversell when inventory services are unhealthy.
- **Security:** Use TLS, authenticated and authorized checkout, payment-provider tokenization, and never store raw card details.
- **Scalability and observability:** Scale stateless web/API capacity horizontally and monitor queue depth, hold conflicts, payment outcomes, latency, and inventory.

## 2. Traffic and capacity estimates

### Assumptions

- The 2 million registered users are the total addressable account base; the supplied 50,000 normal-day visitors are used directly and are not inferred from that registered-user count.
- Normal-day page views are evenly distributed over 24 hours.
- Each normal-day ticket sale results in one successful seat/order transaction.
- During the popular-concert sale, the 200,000 interested people make one initial seat-purchase attempt over the stated 10-minute window; retries and seat-map refreshes are additional traffic.
- The sale-window average is spread evenly over 600 seconds. To account for uneven arrivals, plan for a 5× short burst over that average.
- A page view is one page request; assets and API calls per page are not included and will add traffic.

| Scenario / measure | Calculation | Estimate |
| --- | --- | ---: |
| Normal daily visitors | Given | 50,000 |
| Normal page views per day | 50,000 × 10 | 500,000 |
| Normal average page views per second | 500,000 ÷ 86,400 | 5.8 |
| Normal tickets sold per day | Given | 5,000 |
| Normal average successful sales per second | 5,000 ÷ 86,400 | 0.058 |
| Popular-sale purchase attempts | Given: 200,000 people in 10 minutes | 200,000 |
| Popular-sale average attempts per second | 200,000 ÷ 600 | 333 |
| Planning burst rate for attempts | 333 × 5 | 1,667 per second |
| Seats available for the sale | Given | 20,000 |
| Demand compared with inventory | 200,000 ÷ 20,000 | 10×; 180,000 people cannot receive a seat |

The estimated 333 attempts per second is about 5,700 times the normal successful-sale average, and the 5× burst target is about 28,700 times that normal average. The normal page-view estimate is an all-day average, not the peak of a concert announcement or sale; the sale will also produce bursts of event and seat-map reads, so admission control and caching are important. The five-times burst factor is a planning assumption, not a supplied fact, and should be adjusted using load tests and observed arrival patterns.

## 3. API design

All checkout routes require authentication. `Idempotency-Key` is required on hold and payment requests so client retries do not create duplicate holds or charges. Example IDs and prices are illustrative.

| Method and path | Purpose | Success response |
| --- | --- | --- |
| `GET /api/events?query=&cursor=` | Browse/search upcoming events with pagination. | `200 OK` with event list and next cursor. |
| `GET /api/events/{eventId}` | Get event details, venue, sale window, and pricing summary. | `200 OK` with event. |
| `GET /api/events/{eventId}/seats` | View seat labels, prices, and availability; supports pagination/sections. | `200 OK` with seat availability. |
| `POST /api/events/{eventId}/holds` | Atomically hold one or more available seats for a short, fixed period. | `201 Created` with hold ID, expiration, and seats. |
| `POST /api/orders/{orderId}/payment` | Authorize/capture payment for a valid unexpired hold using a payment-provider token. | `201 Created` with order and payment state. |
| `GET /api/me/tickets?cursor=` | List the authenticated customer's confirmed tickets. | `200 OK` with tickets and next cursor. |
| `DELETE /api/holds/{holdId}` | Release the authenticated customer's active hold. | `204 No Content`. |

Example hold request:

```json
{
  "seatIds": ["seat-A-12"]
}
```

The request also includes `Idempotency-Key: f0e8592b-9cc7-4bf8-a6f3-6b718d2f69d3`.

Example hold response (`201 Created`):

```json
{
  "holdId": "hold-812",
  "eventId": "event-42",
  "seatIds": ["seat-A-12"],
  "expiresAt": "2026-10-14T16:05:00Z",
  "status": "held"
}
```

Example seat-conflict response (`409 Conflict`):

```json
{
  "error": {
    "code": "SEAT_UNAVAILABLE",
    "message": "One or more selected seats are no longer available."
  }
}
```

## 4. Data model

The core model uses **users**, **events**, **seats**, and **orders**, plus **seat_holds** to represent expiring reservations.

- One user can place many orders; each order belongs to one user.
- One event has many seats and many orders; each seat and order belongs to one event.
- A seat can be held by successive customers over time, but can have at most one active hold at a time.
- An order references the purchased event seat; paid/confirmed orders make that seat permanently sold unless a controlled cancellation/refund workflow releases it.
- Holds connect users to seats temporarily and have an expiration; they are separate from completed orders so expired attempts remain auditable.

Illustrative relational schema (PostgreSQL):

```sql
CREATE TABLE users (
    user_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE events (
    event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL,
    venue TEXT NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    sale_opens_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'on_sale', 'sold_out', 'cancelled'))
);

CREATE TABLE seats (
    seat_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(event_id),
    section TEXT NOT NULL,
    row_label TEXT NOT NULL,
    seat_number TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    status TEXT NOT NULL DEFAULT 'available'
        CHECK (status IN ('available', 'held', 'sold')),
    UNIQUE (event_id, section, row_label, seat_number),
    UNIQUE (event_id, seat_id)
);

CREATE TABLE seat_holds (
    hold_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id BIGINT NOT NULL,
    seat_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL REFERENCES users(user_id),
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'consumed', 'expired', 'released')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (event_id, seat_id) REFERENCES seats(event_id, seat_id),
    UNIQUE (user_id, idempotency_key)
);

CREATE UNIQUE INDEX one_active_hold_per_seat
    ON seat_holds (event_id, seat_id)
    WHERE status = 'active';

CREATE TABLE orders (
    order_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(user_id),
    event_id BIGINT NOT NULL,
    seat_id BIGINT NOT NULL,
    hold_id BIGINT NOT NULL UNIQUE REFERENCES seat_holds(hold_id),
    payment_reference TEXT UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('pending_payment', 'paid', 'cancelled', 'refunded')),
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (event_id, seat_id) REFERENCES seats(event_id, seat_id)
);

CREATE UNIQUE INDEX one_live_order_per_seat
    ON orders (event_id, seat_id)
    WHERE status IN ('pending_payment', 'paid');
```

Indexes on active holds and live orders provide database-enforced protection against two concurrent checkout flows claiming the same seat. The unique user/idempotency-key constraint makes repeated client requests safe to reconcile.

## 5. Architecture

```text
 [Customer browser/app]
          |
          v
 [DNS / CDN] ---> [WAF + rate limiter]
                          |
                          v
                  [Load balancer]
                    /          \
                   v            v
             [API server 1]  [API server 2] ... stateless replicas
                   |  \         /  |
                   |   \       /   +------> [Payment provider]
                   |    v     v
                   |  [Sale admission queue / virtual waiting room]
                   |             |
                   v             v
             [Inventory primary database] <----> [Read replica]
                   |
                   +----> [Durable event queue] ---> [Workers]
                                                    (email, reconciliation)
```

- **Customer browser/app:** Displays events and seats, requests queue admission, and submits holds and payments.
- **DNS:** Routes the service hostname to the edge layer and supports endpoint changes without changing client configuration.
- **CDN:** Serves static assets and caches public event descriptions so popular event pages do not overwhelm application servers.
- **WAF and rate limiter:** Filters abusive traffic and enforces per-account/IP limits before requests consume scarce inventory capacity.
- **Virtual waiting room/admission queue:** Meters sale traffic at a controlled rate and issues signed, time-limited queue tokens to reduce overload and improve arrival-order fairness.
- **Load balancer:** Sends admitted API requests only to healthy application instances.
- **API servers:** Authenticate users, validate requests, enforce queue tokens, and coordinate transactional seat holds and orders.
- **Inventory primary database:** Is the authoritative source for seat availability, holds, orders, and payment state, enforcing uniqueness within transactions.
- **Read replica:** Serves event and seat-map reads to reduce primary read load; inventory responses must indicate freshness and final hold decisions always use the primary.
- **Payment provider:** Tokenizes card details and processes authorization/capture without exposing raw payment credentials to TicketHub.
- **Durable event queue:** Buffers post-purchase notifications and reconciliation work so optional side effects do not block checkout.
- **Workers:** Retry idempotent email and payment-reconciliation tasks and report permanently failing work for investigation.

### Sale and double-booking protection

1. At the sale opening, the waiting room issues queue tokens and admits a bounded stream of authenticated requests; the API checks the signed token and rate limits each account.
2. A client views a cached or replica-backed seat map for discovery, but this view is advisory because another buyer may claim a seat at any time.
3. To hold a seat, the API starts a short transaction on the inventory primary, locks the requested seat row (`SELECT ... FOR UPDATE`), expires any stale hold, and conditionally changes the seat from `available` to `held` with an expiration.
4. The transaction creates an active `seat_holds` row and commits only if the seat is still available; the unique active-hold index is a final database-level guard. If a concurrent request wins, the other receives `409 Conflict` and must choose another seat.
5. The customer pays against the hold. The payment request is idempotent; the service confirms payment with the provider and, in a transaction, consumes the still-valid hold, changes the seat to `sold`, and creates the paid order protected by the unique live-order index.
6. If the hold expires or payment fails, a worker or the next hold transaction releases the seat only after verifying that no successful payment/order exists; payment webhooks and retries reconcile through idempotency keys to avoid duplicate charges or tickets.

The database primary serializes conflicting seat updates, a conditional state transition prevents stale clients from overwriting current inventory, and unique constraints make duplicate active holds or live orders impossible even if an application server retries. No seat is treated as sold based only on a cached seat map or a client-side check.

## 6. Trade-offs

- **Strict database serialization versus checkout throughput:** Row locks and unique constraints protect correctness but can become a hotspot for a very popular event. Keep transactions short, lock seats in a consistent order for multi-seat requests, shard inventory by event when scale requires it, and let the waiting room bound admission instead of weakening seat constraints.
- **Fair queueing versus instant access:** A virtual waiting room improves overload control and reduces refresh races, but adds waiting time and a queue service dependency. Use durable queue state, replicated admission infrastructure, signed tokens, clear position estimates, and a documented random/arrival policy; fail closed for purchase admission if tokens cannot be validated.
- **Seat holds versus inventory utilization:** Temporary holds give customers time to pay, but abandoned holds temporarily make seats unavailable. Use short, clearly communicated expirations, idempotent release/reaper jobs, and only release after checking payment state to avoid both stale reservations and paid-seat loss.
- **Replica scale versus seat-map freshness:** Replicas and CDN caching improve browsing performance but can show stale availability. Clearly label seat-map availability as provisional and require every hold and purchase to validate against the primary transactionally.

## Failure handling

Use multiple stateless API servers across availability zones behind a health-checked load balancer; distribute DNS, CDN, and WAF across provider-managed redundant infrastructure. Run the waiting room and durable queue in replicated configurations, and make workers restartable and idempotent. The inventory primary is a critical dependency: deploy synchronous or carefully managed failover to a standby, take point-in-time backups, and test recovery. If the primary or payment state is uncertain, temporarily stop new holds rather than risk selling a seat twice; browsing can continue from cached public event data while checkout is degraded.
