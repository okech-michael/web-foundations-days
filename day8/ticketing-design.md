# TicketHub System Design

## 1. Requirements

### Functional

- Visitors can browse and search events, view event details, and inspect a seat map with prices and current availability.
- A signed-in customer can hold available seats for a limited time, pay for the hold, and view confirmed tickets.
- Customers can view only their own holds, orders, and tickets; staff can manage events, seat maps, prices, and sales.
- The system confirms a ticket only after payment succeeds and the corresponding seat is committed to that order.
- Customers receive clear results when a seat has already been held or sold, a hold expires, or a payment fails.

### Non-functional

- **Correctness:** A seat can belong to at most one active hold or pending/confirmed order. Payment and hold requests must be idempotent so retries do not create duplicate tickets or charges.
- **Fairness:** The sale uses a published virtual-queue policy. Users in the pre-sale waiting room receive positions by a disclosed random draw; later arrivals join at the end. Refreshing does not change or improve a user's signed queue token.
- **Performance:** Keep browse and seat-map responses fast with caching. Give explicit queue, hold-expiry, and checkout status rather than allowing requests to time out silently.
- **Availability:** Scale stateless app servers across zones. If inventory consistency cannot be guaranteed, pause holds and checkout rather than risk overselling; event information can remain available from cache.
- **Security:** Use TLS, authenticated ownership checks, rate limits, and payment-provider tokens; never store card numbers or security codes.
- **Operability:** Monitor latency, queue depth, hold conflicts and expirations, payment outcomes, and database/replica health; retain audit records for orders and inventory changes.

Proposed service targets (to be confirmed with product and operations): p95 event-browse latency below 300 ms at normal load, p95 hold-decision latency below 1 second after queue admission, API availability of at least 99.9% per month, and zero duplicate confirmed seats.

## 2. Estimates

### Assumptions

- The 2 million registered users are the account base; use the supplied 50,000 normal-day visitors directly.
- Normal-day visitors each view 10 pages, and their traffic is averaged across 86,400 seconds.
- The 5,000 normal-day tickets sold represent successful seat/order writes, not every checkout attempt.
- During the concert sale, each of the 200,000 people makes one initial purchase attempt during the first 600 seconds. Retries, polling, and seat-map views are additional requests.
- The sale-window average is spread evenly across 600 seconds. Plan for a 5× short burst (an explicit capacity-planning assumption, not a supplied fact).
- For fairness, the waiting room opens 10 minutes before the sale; accounts present by opening receive a random position, and later accounts join the end. Limit each verified account to one position per event.

| Traffic measure | Calculation | Estimate |
| --- | --- | ---: |
| Normal page views/day | 50,000 visitors × 10 pages | 500,000 |
| Normal average page requests/second | 500,000 ÷ 86,400 | 5.79 (about 6) |
| Normal successful ticket sales/day | Given | 5,000 |
| Normal average successful sales/second | 5,000 ÷ 86,400 | 0.058 |
| Popular-sale initial purchase attempts | Given: 200,000 people in 10 minutes | 200,000 |
| Popular-sale average purchase attempts/second | 200,000 ÷ 600 | 333 |
| Planned 5× short burst of attempts/second | 333 × 5 | 1,667 |
| Seats available for the popular sale | Given | 20,000 |
| Seats sold per second if all sell evenly over 10 minutes | 20,000 ÷ 600 | 33.3 |
| Demand-to-seat ratio | 200,000 ÷ 20,000 | 10:1; at most 20,000 can buy |

The sale's average initial purchase-attempt rate (333/second) is about 5,750 times the normal successful-sale rate (0.058/second); these are different measures, because normal failed attempts are not supplied. If every sale attempt creates one API request, 333 requests/second is about 58 times the normal average of 5.79 page requests/second; this is a rough capacity comparison, not an apples-to-apples workload, and seat-map reads and polling add more traffic. The planned 1,667 attempts/second is a burst target, not a claim that 1,667 sales can complete each second. Only 20,000 seats exist, so admission control must protect inventory and communicate that demand exceeds supply. Load tests and observed traffic should refine the 5× burst assumption.

## 3. API design

All endpoints use HTTPS. Checkout endpoints require authentication and a valid queue token. `Idempotency-Key` is required on hold and order-creation requests. Hold and order operations accept up to four seats per request; each order item represents one seat.

| Method and path | Purpose | Success |
| --- | --- | --- |
| `GET /api/events?query=&cursor=` | Search and browse events using cursor pagination. | `200 OK` |
| `GET /api/events/{eventId}` | View event details, venue, date, and sale status. | `200 OK` |
| `GET /api/events/{eventId}/seats?section=` | View seat labels, prices, and advisory availability by section. | `200 OK` |
| `POST /api/events/{eventId}/holds` | Atomically hold up to four available seats for five minutes. | `201 Created` |
| `POST /api/holds/{holdId}/orders` | Create an order and authorize payment for an active hold. | `202 Accepted` while payment is processing |
| `GET /api/me/tickets?cursor=` | List the authenticated user's confirmed tickets. | `200 OK` |
| `DELETE /api/holds/{holdId}` | Release the authenticated user's active hold. | `204 No Content` |
| `GET /api/me/orders/{orderId}` | Check order/payment status after checkout. | `200 OK` |

Example hold request:

```http
POST /api/events/event-42/holds
Authorization: Bearer <access-token>
Queue-Token: <signed-sale-token>
Idempotency-Key: 70f28cf1-4cf3-4b9d-90d0-f0ab5e43de91
Content-Type: application/json
```

```json
{
  "seatIds": ["seat-A-12", "seat-A-13"]
}
```

Example response (`201 Created`):

```json
{
  "holdId": "hold-812",
  "eventId": "event-42",
  "seatIds": ["seat-A-12", "seat-A-13"],
  "expiresAt": "2026-10-14T16:05:00Z",
  "status": "active"
}
```

If any requested seat is unavailable, the whole hold request fails with `409 Conflict`; it does not partially hold seats. An unavailable seat is never inferred to be yours just because a cached seat map showed it as available.

Example order request:

```http
POST /api/holds/hold-812/orders
Authorization: Bearer <access-token>
Queue-Token: <signed-sale-token>
Idempotency-Key: 5c7d34ac-9fa2-40a7-b4c1-64775291155b
Content-Type: application/json
```

```json
{
  "paymentMethodToken": "payment-provider-token"
}
```

Example response (`202 Accepted`):

```json
{
  "orderId": "order-920",
  "status": "payment_pending",
  "statusUrl": "/api/me/orders/order-920"
}
```

## 4. Data model

The core entities are **users**, **events**, **seats**, and **orders**. **Holds** and **order_items** support expiring reservations and orders containing multiple seats.

- One user can create many holds and orders; each hold/order belongs to one user (one-to-many).
- One event has many seats, holds, and orders; each belongs to one event (one-to-many).
- A hold can cover several seats, and a seat can be held by different customers at different times; `hold_items` records this history (many-to-many over time).
- An order can contain several seats, and a seat can appear in historical cancelled/refunded orders; `order_items` records the order/seat relationship.

The following PostgreSQL schema keeps current seat state on the unique seat row, while holds and order items preserve transaction history. A seat may have only one `active_hold_id` because it is a single nullable column on that row; updates to the row are serialized in a database transaction.

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

CREATE TABLE holds (
    hold_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(event_id),
    user_id BIGINT NOT NULL REFERENCES users(user_id),
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'consumed', 'expired', 'released')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, idempotency_key),
    UNIQUE (event_id, hold_id),
    UNIQUE (event_id, user_id, hold_id)
);

CREATE TABLE seats (
    seat_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(event_id),
    section TEXT NOT NULL,
    row_label TEXT NOT NULL,
    seat_number TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    status TEXT NOT NULL DEFAULT 'available'
        CHECK (status IN ('available', 'held', 'reserved', 'sold')),
    active_hold_id BIGINT,
    UNIQUE (event_id, section, row_label, seat_number),
    UNIQUE (event_id, seat_id),
    FOREIGN KEY (event_id, active_hold_id) REFERENCES holds(event_id, hold_id),
    CHECK ((status = 'held') = (active_hold_id IS NOT NULL))
);

CREATE TABLE hold_items (
    event_id BIGINT NOT NULL,
    hold_id BIGINT NOT NULL,
    seat_id BIGINT NOT NULL,
    price_cents_at_hold INTEGER NOT NULL CHECK (price_cents_at_hold >= 0),
    PRIMARY KEY (hold_id, seat_id),
    UNIQUE (event_id, hold_id, seat_id),
    FOREIGN KEY (event_id, hold_id) REFERENCES holds(event_id, hold_id),
    FOREIGN KEY (event_id, seat_id) REFERENCES seats(event_id, seat_id)
);

CREATE TABLE orders (
    order_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL REFERENCES users(user_id),
    hold_id BIGINT NOT NULL UNIQUE REFERENCES holds(hold_id),
    idempotency_key TEXT NOT NULL,
    payment_reference TEXT UNIQUE,
    status TEXT NOT NULL
        CHECK (status IN ('payment_pending', 'paid', 'payment_failed', 'cancelled', 'refunded')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, idempotency_key),
    UNIQUE (event_id, order_id),
    FOREIGN KEY (event_id, user_id, hold_id)
        REFERENCES holds(event_id, user_id, hold_id)
);

CREATE TABLE order_items (
    event_id BIGINT NOT NULL,
    order_id BIGINT NOT NULL,
    hold_id BIGINT NOT NULL,
    seat_id BIGINT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    status TEXT NOT NULL CHECK (status IN ('payment_pending', 'paid', 'cancelled', 'refunded')),
    PRIMARY KEY (order_id, seat_id),
    FOREIGN KEY (event_id, order_id) REFERENCES orders(event_id, order_id),
    FOREIGN KEY (event_id, hold_id, seat_id) REFERENCES hold_items(event_id, hold_id, seat_id),
    FOREIGN KEY (event_id, seat_id) REFERENCES seats(event_id, seat_id)
);

CREATE TABLE outbox_events (
    outbox_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type TEXT NOT NULL,
    aggregate_id BIGINT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX one_live_order_per_seat
    ON order_items (event_id, seat_id)
    WHERE status IN ('payment_pending', 'paid');

CREATE INDEX seats_event_status_section
    ON seats (event_id, status, section, row_label, seat_number);

CREATE INDEX holds_expiration
    ON holds (expires_at)
    WHERE status = 'active';

CREATE INDEX outbox_unpublished
    ON outbox_events (outbox_id)
    WHERE published_at IS NULL;
```

`one_live_order_per_seat` prevents two pending/paid orders from claiming one seat. The seat-row lock and conditional state update protect the earlier hold step; the index is a second guard at order creation. The event/status/section index speeds seat-map queries, and the partial hold-expiration index helps the expiry worker find active holds that need processing.

### Example SQL queries

List one event's seat map:

```sql
SELECT seat_id, section, row_label, seat_number, price_cents, status
FROM seats
WHERE event_id = :event_id
ORDER BY section, row_label, seat_number;
```

Find confirmed tickets for one user (JOIN):

```sql
SELECT o.order_id, e.name AS event_name, s.section, s.row_label, s.seat_number
FROM orders AS o
JOIN events AS e ON e.event_id = o.event_id
JOIN order_items AS oi ON oi.order_id = o.order_id AND oi.event_id = o.event_id
JOIN seats AS s ON s.seat_id = oi.seat_id AND s.event_id = oi.event_id
WHERE o.user_id = :user_id
  AND o.status = 'paid'
  AND oi.status = 'paid'
ORDER BY e.starts_at;
```

Expire timed-out holds and release only seats still held by those holds:

```sql
WITH expired AS (
    UPDATE holds
    SET status = 'expired'
    WHERE status = 'active'
      AND expires_at <= now()
    RETURNING hold_id, event_id
)
UPDATE seats AS s
SET status = 'available',
    active_hold_id = NULL
FROM expired AS h
WHERE s.event_id = h.event_id
  AND s.active_hold_id = h.hold_id
  AND s.status = 'held';
```

The hold-state transition and matching seat release run atomically in one statement; the matching `active_hold_id` prevents expiry from clearing a newer customer's hold.

## 5. Architecture

```text
[Client] --> [DNS] --> [CDN + WAF + rate limiter] --> [Sale waiting room] --> [Load balancer]
                                                                         /                 \
                                                                        v                   v
                                                                [App server A]       [App server B]
                                                                 \                   /
                                                                  +--------+--------+
                                                                           |
                          +--------------------------------+---------------+-----------------------+
                          |                                |                                       |
                          v                                v                                       v
                     [Cache]                    [Primary database]                    [Payment provider]
                                                         |                                  authorization
                                      +------------------+------------------+
                                      |                                     |
                                      v                                     v
                              [Read replica]                      [Outbox publisher]
                                                                          |
                                                                          v
                                                               [Durable job queue]
                                                                          |
                                                                          v
                                                                      [Workers]
                                                                          |
                                                                          v
                                                               [Payment provider]
                                                                       capture

[Client] <---- static files and cacheable public event data ----> [CDN]
```

- **Client:** Presents events, seat availability, queue position, hold countdowns, and order status.
- **DNS:** Resolves the public service name to the edge entry point and permits endpoint changes without client changes.
- **CDN:** Serves static files and cacheable public event details close to customers, reducing origin traffic during a sale.
- **WAF and rate limiter:** Rejects malicious or excessive requests before they consume application or inventory capacity.
- **Sale waiting room:** Applies the published admission policy and meters authenticated purchase traffic before it reaches checkout.
- **Load balancer:** Sends API requests only to healthy app instances and spreads traffic across zones.
- **App servers A and B:** Run stateless API logic so more instances can be added for sale traffic and a failed instance can be removed without losing inventory state.
- **Cache:** Holds popular event and seat-map read data to lower database load; it is never authoritative for hold or sale decisions.
- **Primary database:** Serializes inventory changes and stores authoritative users, seats, holds, and orders with transactions and constraints.
- **Read replica:** Serves eligible browse queries to offload the primary; it may lag and is never used to decide if a seat can be held or sold.
- **Durable job queue:** Buffers payment capture, emails, reconciliation, and hold-expiry jobs so bursts or worker restarts do not lose work.
- **Outbox publisher:** Reads unpublished events committed with orders from the database and publishes them to the queue, avoiding a lost job if an app server fails after committing an order.
- **Workers:** Process queued side effects with retries and idempotency without blocking checkout responses.
- **Payment provider:** Authorizes and captures tokenized payment details; TicketHub never stores raw card information, and the API servers communicate with it over TLS.

### How the system prevents double-booking

1. A customer receives a signed queue token. The sale service admits a bounded number of customers at a time; pre-sale entrants receive queue positions by the published random draw, and later entrants join the end. A token is bound to the account/session and cannot be improved by refreshing.
2. The customer selects seats from a possibly cached map. Availability displayed on that map is advisory, not a reservation.
3. For `POST /holds`, the app opens a short transaction on the primary database and locks all requested seat rows in ascending `seat_id` order (`SELECT ... FOR UPDATE`) to avoid deadlocks.
4. Within the same transaction, it expires any stale hold on those seats, verifies that every seat is `available`, creates one hold plus its `hold_items`, and updates all seat rows to `held` with that hold ID. If any seat is unavailable, it rolls back the entire request and returns `409 Conflict`; no partial hold is made.
5. For payment, the app first obtains an idempotent authorization from the payment provider while the hold remains valid. It then starts another short database transaction, locks the hold and seats, verifies the hold has not expired, inserts the order and all `order_items`, marks the hold `consumed`, changes each seat to `reserved` with `active_hold_id = NULL`, and inserts a payment-capture event into the outbox. The seats are unavailable to other buyers while payment is pending; the partial unique index rejects any duplicate live order even if an application bug attempts one.
6. If the hold expired before the second transaction commits, the app voids the payment authorization and does not create the order. After a successful commit, the API returns `202 Accepted`; the outbox publisher sends the capture job to the durable queue, and a worker captures payment using the provider idempotency key. On confirmed capture, a transaction marks the order and items `paid` and seats `sold`; only then is a ticket confirmed. The customer polls `GET /api/me/orders/{orderId}` or receives an update until payment is `paid`. If capture fails, reconciliation confirms the provider's state before marking the order `payment_failed`, its items `cancelled`, and returning the seats to `available` in one transaction. It never frees a seat while a charge may have succeeded.
7. An expiry worker changes an elapsed hold from `active` to `expired` and releases only seats still marked `held` with that exact `active_hold_id`, in one transaction. This prevents a delayed expiry job from clearing a newer customer's hold.

The primary database is the single authority for each seat's state. Row locks serialize simultaneous attempts, conditional state transitions reject stale requests, and the unique live-order index provides a final constraint-level defense. A cache or seat map can never authorize a purchase.

## 6. Trade-offs and failure handling

- **Strict inventory transactions vs. sale throughput:** Row locks and unique constraints protect correctness but serialize buyers competing for the same seats. Keep transactions short, lock multi-seat requests in a stable order, and use the waiting room to meter writes; do not remove consistency constraints to increase throughput.
- **Fairness vs. immediate access:** A virtual waiting room controls overload, but adds wait time and queue infrastructure. Publish the policy, keep queue tokens stable across refreshes, and monitor queue progress; randomize pre-sale entrants to avoid rewarding faster devices or clock manipulation.
- **Seat holds vs. available inventory:** A five-minute hold gives a customer time to pay but can temporarily strand seats when customers abandon checkout. Use a visible countdown, idempotent expiry workers, and transactional release only after payment state is known.
- **Freshness vs. read scale:** CDN/cache/read-replica data may be stale but takes browse load off the primary. Clearly label availability as provisional and always check/commit holds on the primary.
- **Payment consistency vs. response time:** Payment providers cannot join the database transaction. Use authorization, idempotency keys, durable reconciliation, and explicit `payment_pending` order status; prefer a temporarily held seat over either a duplicate sale or releasing a seat after a possibly successful charge.

Run multiple stateless app instances across availability zones behind a health-checked load balancer. Use managed, redundant DNS/CDN/load-balancing services, a replicated waiting-room/queue service, and workers that can restart safely. Configure the primary database for tested failover and point-in-time recovery. If database or payment status is uncertain, pause new holds and reconcile rather than risk overselling; keep public event browsing available from cached data where possible.
