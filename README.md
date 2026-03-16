# Lpdc Feedback Management Service

Microservice used to ingest feedback data from ipdc ldes feed + flag instances based on available feedback.
It handles publishing answers on feedbacks to ipdc when a feedback is in the correct state.
Designed for the [semantic.works](https://semantic.works/) microservices stack.
This microservice is made for [LPDC](https://github.com/lblod/app-lpdc-digitaal-loket) but can be configured via
environment variables to be used in other applications that use the same feedback resource.

## How It Works

1. The service listens for delta notifications from [delta-notifier](https://github.com/mu-semtech/delta-notifier)
2. When a feedback's ipdc-status changes to the configured 'start' ipdc-status, it gets the instance linked to the
   feedback.
3. The service updates the `lpdcExt:feedbackAvailable` flag on the instance resource and sets the configured 'start'
   status on the feedback.
4. When a feedback's status is changed to the configured 'end' status, it unflags the instance if there are no other
   linked feedback in the 'start' ipdc-status.

There is also a cronjob that runs daily to make sure missed deltas are handled.

The microservice handles ingesting feedback ldes data from ipdc + enriches this data.
It does this via a cronjob + delta's that
moves incoming feedback snapshots to it's correct organization graph with some added enrichments.

Finally, this service publishes answers on feedback to the ipdc answer endpoint. It uses retry logic
to handle failed publish calls and records errors in the ipdc-feedback-publication-errors graph.

## Installation

### Docker Compose

Add the service to your `docker-compose.yml`:

```yaml
  lpdc-feedback-management-service:
    image: lblod/lpdc-feedback-management-service
    environment:
      IPDC_JSON_ENDPOINT: "Insert ipdc feedback publish endpoint"
      IPDC_X_API_KEY: 'Insert credentials for publish endpoint'
    labels:
      - "logging=true"
    restart: always
```

### Delta Notifier Configuration

Add a rule to your `config/delta/rules.js` to trigger on feedback status changes:

```javascript
{
   match: {
      predicate: {
         type: 'uri',
                 value: 'https://www.w3.org/ns/adms#status'
      },
      object: {
         type: 'uri',
                 value: 'https://ipdc.vlaanderen.be/ns/FeedbackStatus#AANGEMAAKT'
      }
   },
   callback: {
      url: 'http://lpdc-feedback-management-service/delta-status-start',
              method: 'POST'
   },
   options: {
      resourceFormat: 'v0.0.1',
              gracePeriod: 1000,
              ignoreFromSelf: false
   }
},
{
   match: {
      predicate: {
         type: 'uri',
                 value: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
      },
      object: {
         type: 'uri',
                 value: 'https://schema.org/Conversation'
      },
      graph: {
         type: 'uri',
                 value: 'http://mu.semte.ch/graphs/lpdc/feedbacksnapshot-ldes-data'
      }
   },
   callback: {
      url: 'http://lpdc-feedback-management-service/delta-ingest',
              method: 'POST'
   },
   options: {
      resourceFormat: 'v0.0.1',
              gracePeriod: 1000,
              ignoreFromSelf: true
   }
},
{
   match: {
      predicate: {
         type: 'uri',
                 value: 'https://schema.org/actionStatus'
      },
      object: {
         type: 'uri',
                 value: 'http://lblod.data.gift/concepts/2e4a6c8d-9f1b-4d3e-5a7c-9e1f3b5d7a9c'
      }
   },
   callback: {
      url: 'http://lpdc-feedback-management-service/delta-status-end',
              method: 'POST'
   },
   options: {
      resourceFormat: 'v0.0.1',
              gracePeriod: 1000,
              ignoreFromSelf: false
   }
}
```

## Configuration

### Environment Variables

| Variable                    | Required | Default                                                                            | Description                                                                                         |
|-----------------------------|----------|------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `IPDC_STATUS_PREDICATE`     | No       | 'https://www.w3.org/ns/adms#status'                                                | Predicate URI that links feedback with it's ipdc-status                                             |
| `IPDC_STATUS_START_URI`     | No       | 'https://ipdc.vlaanderen.be/ns/FeedbackStatus#AANGEMAAKT'                          | Object URI of the specific ipdc-status to flag on                                                   |
| `INSTANCE_PREDICATE`        | No       | 'http://www.w3.org/2004/02/skos/core#primarySubject'                               | Predicate URI that links feedback to instance                                                       |
| `INSTANCE_TYPE`             | No       | 'https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#InstancePublicService' | Type URI of the instance that has to be flagged                                                     |
| `LPDC_STATUS_PREDICATE`     | No       | 'https://schema.org/actionStatus'                                                  | Predicate URI that links feedback with it's lpdc-status                                             |
| `LPDC_STATUS_START_URI`     | No       | 'http://lblod.data.gift/concepts/1b3c5e7f-2a4d-4c6e-9f1b-3d5a7c9e2f4b'             | Object URI of the specific lpdc-status to set when feedback has ipdc-status `IPDC_STATUS_START_URI` |
| `LPDC_STATUS_END_URI`       | No       | 'http://lblod.data.gift/concepts/2e4a6c8d-9f1b-4d3e-5a7c-9e1f3b5d7a9c'             | Object URI of the specific lpdc-status to remove the flag on linked instance                        |
| `LPDC_STATUS_PUBLISHED_URI` | No       | 'http://lblod.data.gift/concepts/a0575bbd-17b6-4f04-b1b2-e554e29cd428'             | Object URI of the specific lpdc-status to set when publishing a feedback object                     |
| `LDES_GRAPH`                | No       | 'http://mu.semte.ch/graphs/lpdc/feedbacksnapshot-ldes-data'                        | Graph URI where feedback ldes data arrives from ipdc                                                |
| `UNKNOWN_GRAPH`             | No       | 'http://mu.semte.ch/graphs/lpdc/feedbacksnapshot-ldes-data/unknown'                | Graph URI where feedbacks are saved when receiver is not known in lpdc                              |
| `HEALING_CRON`              | No       | '0 3 * * *'                                                                        | Cron pattern to start healing cronjob                                                               |
| `INGEST_CRON`               | No       | '*/1 * * * *'                                                                      | Cron pattern to start ldes ingest cronjob                                                           |
| `PUBLISH_CRON`              | No       | '*/1 * * * *'                                                                      | Cron pattern to start feedback publish cronjob                                                      |
| `RETRY_COUNTER_LIMIT`       | No       | 5                                                                                  | Amount of allowed retries to publish a feedback object                                              |
| `ERROR_EXPIRATION_MONTHS`   | No       | 1                                                                                  | Amount of months to save PublicationErrors before deleting them                                     |
| `IPDC_JSON_ENDPOINT`        | yes      | no default                                                                         | Ipdc publish endpoint                                                                               |
| `IPDC_X_API_KEY`            | yes      | no default                                                                         | Credentials for `IPDC_JSON_ENDPOINT`                                                                |
| `DEBUG`                     | No       | `false`                                                                            | Enable debug logging                                                                                |

## API

### GET /

Health check endpoint. Returns a welcome message.

**Response**:

- `200 OK` - Returns "Hello, you've reached the lpdc-feedback-management-service."

### POST /delta-ingest

Receives delta notifications for new feedback snapshots arriving in the LDES graph.

**Request Body**: Delta notification in mu-delta-notifier format (v0.0.1)

**Response**:

- `204 No Content` - Delta received and being processed

**Functionality**:
- Extracts new `schema:Conversation` resources from the LDES graph
- Processes feedback snapshots asynchronously
- Enriches and moves feedback to appropriate organization graphs

### POST /delta-status-start

Receives delta notifications when feedback changes to the configured start ipdc-status (default: `AANGEMAAKT`).

**Request Body**: Delta notification in mu-delta-notifier format (v0.0.1)

**Response**:

- `204 No Content` - Delta received and being processed

**Functionality**:
- Extracts feedback URIs that received the start ipdc-status
- Finds linked instances
- Sets `lpdcExt:feedbackAvailable` flag to `true` on instances
- Sets the configured lpdc-status on feedback

### POST /delta-status-end

Receives delta notifications when feedback changes to the configured end lpdc-status (default: `Verwerkt`).

**Request Body**: Delta notification in mu-delta-notifier format (v0.0.1)

**Response**:

- `204 No Content` - Delta received and being processed

**Functionality**:
- Extracts feedback URIs that received the end lpdc-status
- Finds linked instances
- Unflags instances if no other open feedback exists
- Sets `lpdcExt:feedbackAvailable` flag to `false` when appropriate

## Scheduled Jobs

### LDES Ingest Job

**Schedule**: Configurable via `INGEST_CRON` (default: `*/1 * * * *` - every minute)

**Functionality**:
- Processes any pending feedback snapshots in the LDES graph
- Complements delta-based ingestion to ensure no snapshots are missed
- Runs asynchronously to avoid blocking

### Publish Job

**Schedule**: Configurable via `PUBLISH_CRON` (default: `*/1 * * * *` - every minute)

**Functionality**:
- Finds feedback answers ready to publish to IPDC
- Validates and enriches payloads (converts bestuurseenheid to OVO concept if needed)
- Sends HTTP POST requests to configured `IPDC_JSON_ENDPOINT` with `IPDC_X_API_KEY`
- On success: Updates feedback to published status
- On failure: Increments retry counter (max: `RETRY_COUNTER_LIMIT`)
- Records publication errors in dedicated graph for debugging

### Healing Job

**Schedule**: Configurable via `HEALING_CRON` (default: `0 3 * * *` - daily at 3 AM)

**Functionality**:
- Recovers from missed delta notifications
- Sets missing lpdc-status on feedbacks with ipdc-status `AANGEMAAKT`
- Unflags instances that are incorrectly flagged as having feedback
- Flags instances that should be flagged but aren't
- Ensures data consistency across the system

## Related Services

- [delta-notifier](https://github.com/mu-semtech/delta-notifier) - Triggers this service on data changes
- [ldes-consumer-feedbacksnapshot-ipdc](https://github.com/lblod/ldes-consumer-service) - Consumes IPDC LDES feed into the database
- [LPDC](https://github.com/lblod/app-lpdc-digitaal-loket) - Main application using this service