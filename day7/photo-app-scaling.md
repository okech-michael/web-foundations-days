# SnapShare Scaling Plan

## Assumptions and estimates

- There are 10 million registered users, and 10% are active on a typical day.
- Each daily active user uploads one original photo and views 50 feed pages per day.
- Each original photo is 2 MB, and its generated thumbnail is 50 KB.
- A day has 86,400 seconds and a year has 365 days. For storage estimates, MB and KB are decimal units; all uploads are retained for the year, with no compression, replication, or storage overhead included.
- Average request rates are spread evenly across the day. Peak feed traffic is estimated at five times the average; no peak multiplier was specified for uploads.

Daily active users:

`10,000,000 registered users × 0.10 = 1,000,000 daily active users`

| Measure | Calculation | Estimate |
| --- | --- | ---: |
| Photo uploads per day | 1,000,000 active users × 1 photo | 1,000,000 |
| Average uploads per second | 1,000,000 ÷ 86,400 | 11.6 |
| Feed page views per day | 1,000,000 active users × 50 views | 50,000,000 |
| Average feed views per second | 50,000,000 ÷ 86,400 | 578.7 (about 579) |
| Peak feed views per second | 578.7 × 5 | 2,893.5 (about 2,894) |
| Original-photo storage per year | 1,000,000 × 2 MB × 365 | 730 TB |
| Thumbnail storage per year | 1,000,000 × 50 KB × 365 | 18.25 TB |
| Total photo storage per year | 730 TB + 18.25 TB | 748.25 TB (about 0.75 PB) |

## Traffic profile

SnapShare is **read-heavy**: users request 50 feed pages for each photo they upload, or roughly 50 feed reads per upload before counting image delivery. The design should scale feed and image reads horizontally, use caching and a CDN to absorb repeat traffic, and keep upload processing asynchronous so it does not slow the feed.

## Architecture

```text
[Client] -- API requests --> [Load balancer] --> [App servers] <--> [Cache]
                                                    |       |
                                                    |       +--> [Database primary]
                                                    |                    |
                                                    |               replication
                                                    |                    v
                                                    |             [Read replica]
                                                    |
                                                    +--> [Queue] --> [Thumbnail worker] --> [Object storage]
                                                                                              originals/thumbs

[Client] -- direct upload using short-lived URL -------------------------------------------> [Object storage]
[Client] -- image request --> [CDN] -- cache miss / origin fetch --------------------------> [Object storage]
                               <-- cached photo response --
```

### Component responsibilities

- **Client:** Sends feed and upload requests and displays the feed and uploaded photos.
- **CDN:** Caches and serves photo files near viewers, reducing origin bandwidth and image-fetch latency.
- **Load balancer:** Distributes incoming API traffic across healthy app servers.
- **App servers:** Authenticate requests and implement upload, feed, and metadata APIs without holding photo files in memory longer than needed.
- **Cache:** Stores frequently requested feed data and metadata to reduce repeated database reads and feed latency.
- **Database primary:** Stores durable structured data such as users, follows, photo metadata, and feed relationships, and accepts writes.
- **Database read replica:** Serves read-only feed and metadata queries to scale reads while replicating updates from the primary.
- **Object storage:** Durably stores original photos and generated thumbnails as files, independently scaling capacity from relational metadata.
- **Queue:** Buffers thumbnail jobs so photo uploads can complete without waiting for image processing.
- **Thumbnail worker:** Consumes queued jobs, creates resized images, and stores the thumbnails in object storage.

## Photo upload flow

1. The client asks an app server to begin an upload; the server authenticates the user, checks the file's type and size, and creates a photo record with a pending-processing state.
2. The app server returns a short-lived, restricted upload URL for object storage, so the client can upload the original photo directly without routing its full contents through the app server.
3. The client uploads the original to object storage and notifies the app server when the upload finishes.
4. The app server verifies the uploaded object, records its storage key and metadata in the database primary, and publishes a thumbnail job to the queue.
5. The app server acknowledges the upload while the photo is marked as processing; it does not wait for thumbnail generation.
6. A thumbnail worker consumes the job, reads the original from object storage, creates the thumbnail, and writes it back to object storage.
7. The worker updates the photo metadata to indicate that processing is complete; the CDN can then serve the original and thumbnail on demand, caching them near users.

## Why photos belong in object storage

Photo files are large binary objects, while the database is better suited to structured, queryable records such as captions, ownership, follow relationships, and object keys. Putting image bytes in the database would inflate backups and replication traffic, consume database capacity, and compete with latency-sensitive feed queries. Object storage is designed for durable, high-capacity file storage, and the CDN can cache those files without routing every image read through the database or app servers.

## Trade-offs

- **Cache speed versus freshness:** Feed and metadata caching lowers database load and read latency, but cached feeds can briefly show stale data after a user posts or follows someone. Short TTLs or targeted cache invalidation improve freshness but add complexity and may increase database traffic.
- **Fast uploads versus immediate availability:** A queue lets the upload API respond quickly and absorbs bursts, but thumbnail generation is eventually consistent. Users may briefly see a processing placeholder; retry handling and dead-letter monitoring are needed for failed jobs.
- **Direct object uploads versus simpler request routing:** Short-lived upload URLs keep large file bodies off app servers and make upload capacity easier to scale, but require careful URL expiry, permissions, object ownership verification, and validation of the completed upload.
- **CDN performance versus cost and privacy controls:** CDN caching reduces image latency and origin bandwidth, but adds cache invalidation and access-control concerns and incurs bandwidth costs; private photos need authorization-aware delivery rather than publicly cacheable URLs.
