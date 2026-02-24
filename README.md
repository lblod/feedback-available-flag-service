# Lpdc Feedback Management Service

Microservice used to ingest feedback data from ipdc ldes feed + flag instances based on available feedback. Designed for
the [semantic.works](https://semantic.works/) microservices stack.
This microservice is made for [LPDC](https://github.com/lblod/app-lpdc-digitaal-loket) but can be configured via
environment variables to be used in other applications that use the same feedback resource.

## How It Works

1. The service listens for delta notifications from [delta-notifier](https://github.com/mu-semtech/delta-notifier)
2. When a feedback's ipdc-status changes to the configured 'start' ipdc-status, it gets the instance linked to the
   feedback.
3. The service updates the `lpdcExt:feedbackAvailable` flag on the instance resource and sets the configured 'start'
   status on the feedback.
4. When a feedback's status is changed to the configured 'end' status, it unflags the instance if there are no other linked feedback in the 'start' ipdc-status.

There is also a cronjob that runs daily to make sure missed deltas are handled.

Besides the above, the microservice also handles ingesting feedback ldes data from ipdc + enriching this data. It does
this via a cronjob that
moves incoming feedback snapshots to it's correct organization graph with some added enrichments.

## Installation

### Docker Compose

Add the service to your `docker-compose.yml`:

```yaml
  lpdc-feedback-management-service:
    image: lblod/lpdc-feedback-management-service
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
      url: 'http://lpdc-feedback-management-service/delta',
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
                 value: 'https://schema.org/actionStatus'
      },
      object: {
         type: 'uri',
                 value: 'http://lblod.data.gift/concepts/2e4a6c8d-9f1b-4d3e-5a7c-9e1f3b5d7a9c'
      }
   },
   callback: {
      url: 'http://lpdc-feedback-management-service/delta',
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

| Variable                | Required | Default                                                                            | Description                                                                                         |
|-------------------------|----------|------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `IPDC_STATUS_PREDICATE` | No       | 'https://www.w3.org/ns/adms#status'                                                | Predicate URI that links feedback with it's ipdc-status                                             |
| `IPDC_STATUS_START_URI` | No       | 'https://ipdc.vlaanderen.be/ns/FeedbackStatus#AANGEMAAKT'                          | Object URI of the specific ipdc-status to flag on                                                   |
| `INSTANCE_PREDICATE`    | No       | 'http://www.w3.org/2004/02/skos/core#primarySubject'                               | Predicate URI that links feedback to instance                                                       |
| `INSTANCE_TYPE`         | No       | 'https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#InstancePublicService' | Type URI of the instance that has to be flagged                                                     |
| `LPDC_STATUS_PREDICATE` | No       | 'https://schema.org/actionStatus'                                                  | Predicate URI that links feedback with it's lpdc-status                                             |
| `LPDC_STATUS_START_URI` | No       | 'http://lblod.data.gift/concepts/1b3c5e7f-2a4d-4c6e-9f1b-3d5a7c9e2f4b'             | Object URI of the specific lpdc-status to set when feedback has ipdc-status `IPDC_STATUS_START_URI` |
| `LPDC_STATUS_END_URI`   | No       | 'http://lblod.data.gift/concepts/2e4a6c8d-9f1b-4d3e-5a7c-9e1f3b5d7a9c'             | Object URI of the specific lpdc-status to remove the flag on linked instance                        |
| `LDES_GRAPH`            | No       | 'http://mu.semte.ch/graphs/lpdc/feedbacksnapshot-ldes-data'                        | Graph URI where feedback ldes data arrives from ipdc                                                |
| `UNKNOWN_GRAPH`         | No       | 'http://mu.semte.ch/graphs/lpdc/feedbacksnapshot-ldes-data/unknown-receiver'       | Graph URI where feedbacks are saved when receiver is not known in lpdc                              |
| `HEALING_CRON`          | No       | '0 3 * * *'                                                                        | Cron pattern to start healing cronjob                                                               |
| `INGEST_CRON`           | No       | '*/1 * * * *'                                                                      | Cron pattern to start ldes ingest cronjob                                                           |
| `DEBUG`                 | No       | `false`                                                                            | Enable debug logging                                                                                |

## API

### GET /

Health check endpoint. Returns a welcome message.

### POST /delta

Receives delta notifications from the delta-notifier. Flags instances based on status change.

**Request Body**: Delta notification in mu-delta-notifier format (v0.0.1)

**Response**:

- `204 No Content` - Delta received and being processed

## Related Services

- [delta-notifier](https://github.com/mu-semtech/delta-notifier) - Triggers this service on data changes
- [LPDC](https://github.com/lblod/app-lpdc-digitaal-loket) - Used in this app