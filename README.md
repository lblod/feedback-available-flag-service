# Feedback Available Flag Service

Microservice that is used to flag instances based on available feedback. Designed for
the [semantic.works](https://semantic.works/) microservices stack.
This microservice is made for [LPDC](https://github.com/lblod/app-lpdc-digitaal-loket) but can be configured via
environment variables to be used
in other applications that use the same feedback resource.

## How It Works

1. The service listens for delta notifications from [delta-notifier](https://github.com/mu-semtech/delta-notifier)
2. When a feedbacks's status changes to or from the configured 'available' status, it gets the instance linked to the
   feedback.
3. The service updates the `schema:flagged` flag on the instance resource

There is also a cronjob that runs daily to make sure missed deltas are handled.

## Installation

### Docker Compose

Add the service to your `docker-compose.yml`:

```yaml
  feedback-available-flag-service:
    image: local/feedback-available-flag-service
    environment:
      STATUS_PREDICATE: 'https://schema.org/actionStatus'
      STATUS_URI: 'http://lblod.data.gift/concepts/1b3c5e7f-2a4d-4c6e-9f1b-3d5a7c9e2f4b'
      INSTANCE_TYPE: 'https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#InstancePublicService'
      INSTANCE_PREDICATE: 'http://www.w3.org/2004/02/skos/core#primarySubject'
      HEALING_CRON: '0 3 * * *'
      DEBUG: false
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
                 value: 'https://schema.org/actionStatus'
      },
      object: {
         type: 'uri',
                 value: 'http://lblod.data.gift/concepts/1b3c5e7f-2a4d-4c6e-9f1b-3d5a7c9e2f4b'
      }
   },
   callback: {
      url: 'http://feedback-available-flag-service/delta',
              method: 'POST'
   },
   options: {
      resourceFormat: 'v0.0.1',
              gracePeriod: 1000,
              ignoreFromSelf: true
   }
}
```

## Configuration

### Environment Variables

| Variable             | Required | Default                                                                            | Description                                        |
|----------------------|----------|------------------------------------------------------------------------------------|----------------------------------------------------|
| `STATUS_PREDICATE`   | No       | 'https://schema.org/actionStatus'                                                  | Predicate URI that links feedback with it's status |
| `STATUS_URI`         | No       | 'http://lblod.data.gift/concepts/1b3c5e7f-2a4d-4c6e-9f1b-3d5a7c9e2f4b'             | Object URI of the specific status to flag on       |
| `INSTANCE_TYPE`      | No       | 'https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#InstancePublicService' | Type URI of the instance that has to be flagged    |
| `INSTANCE_PREDICATE` | No       | 'http://www.w3.org/2004/02/skos/core#primarySubject'                               | Predicate URI that links feedback to instance      |
| `HEALING_CRON`       | No       | '0 3 * * *'                                                                        | Cron pattern to start healing cronjob              |
| `DEBUG`              | No       | `false`                                                                            | Enable debug logging                               |

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