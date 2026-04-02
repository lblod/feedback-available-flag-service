import env from 'env-var';

const IPDC_STATUS_PREDICATE = env.get('IPDC_STATUS_PREDICATE').default('http://www.w3.org/ns/adms#status').asString();
const IPDC_STATUS_START_URI = env.get('IPDC_STATUS_START_URI').default('https://ipdc.vlaanderen.be/ns/FeedbackStatus#AANGEMAAKT').asString();
const INSTANCE_PREDICATE = env.get('INSTANCE_PREDICATE').default('http://www.w3.org/2004/02/skos/core#primarySubject').asString();
const INSTANCE_TYPE = env.get('INSTANCE_TYPE').default('https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#InstancePublicService').asString();
const LPDC_STATUS_PREDICATE = env.get('LPDC_STATUS_PREDICATE').default('https://schema.org/actionStatus').asString();
const LPDC_STATUS_START_URI = env.get('LPDC_STATUS_START_URI').default('http://lblod.data.gift/concepts/1b3c5e7f-2a4d-4c6e-9f1b-3d5a7c9e2f4b').asString();
const LPDC_STATUS_END_URI = env.get('LPDC_STATUS_END_URI').default('http://lblod.data.gift/concepts/2e4a6c8d-9f1b-4d3e-5a7c-9e1f3b5d7a9c').asString();
const LPDC_STATUS_PUBLISHED_URI = env.get('LPDC_STATUS_PUBLISHED_URI').default('http://lblod.data.gift/concepts/a0575bbd-17b6-4f04-b1b2-e554e29cd428').asString();
const LPDC_PROCESSING_STATUS_PREDICATE = env.get('LPDC_PROCESSING_STATUS_PREDICATE').default('https://schema.org/result').asString();
const LPDC_PROCESSING_STATUS_ACCEPTED_URI = env.get('LPDC_PROCESSING_STATUS_ACCEPTED_URI').default('http://lblod.data.gift/concepts/caa0b2d0-4bfa-46c8-8ee3-f77d0fdfa655').asString();
const LPDC_PROCESSING_STATUS_DENIED_URI = env.get('LPDC_PROCESSING_STATUS_DENIED_URI').default('http://lblod.data.gift/concepts/094d76ed-59c9-45a6-9f62-f93f79675c00').asString();
const LDES_GRAPH = env.get('LDES_GRAPH').default('http://mu.semte.ch/graphs/lpdc/feedbacksnapshot-ldes-data').asString();
const UNKNOWN_GRAPH = env.get('UNKNOWN_GRAPH').default('http://mu.semte.ch/graphs/lpdc/feedbacksnapshot-ldes-data/unknown').asString();
const HEALING_CRON = env.get('HEALING_CRON').default('0 3 * * *').asString();
const INGEST_CRON = env.get('INGEST_CRON').default('*/1 * * * *').asString();
const PUBLISH_CRON = env.get('PUBLISH_CRON').default('*/1 * * * *').asString();
const RETRY_COUNTER_LIMIT = env.get('RETRY_COUNTER_LIMIT').default(5).asInt();
const ERROR_EXPIRATION_MONTHS = env.get('ERROR_EXPIRATION_MONTHS').default(1).asInt();
const IPDC_JSON_ENDPOINT = env.get('IPDC_JSON_ENDPOINT').required().asString();
const IPDC_X_API_KEY = env.get('IPDC_X_API_KEY').required().asString();
const DEBUG = env.get('DEBUG').default('false').asBool();


export {
    IPDC_STATUS_PREDICATE,
    IPDC_STATUS_START_URI,
    INSTANCE_PREDICATE,
    INSTANCE_TYPE,
    LPDC_STATUS_PREDICATE,
    LPDC_STATUS_START_URI,
    LPDC_STATUS_END_URI,
    LPDC_STATUS_PUBLISHED_URI,
    LPDC_PROCESSING_STATUS_PREDICATE,
    LPDC_PROCESSING_STATUS_ACCEPTED_URI,
    LPDC_PROCESSING_STATUS_DENIED_URI,
    LDES_GRAPH,
    UNKNOWN_GRAPH,
    HEALING_CRON,
    INGEST_CRON,
    PUBLISH_CRON,
    RETRY_COUNTER_LIMIT,
    ERROR_EXPIRATION_MONTHS,
    IPDC_JSON_ENDPOINT,
    IPDC_X_API_KEY,
    DEBUG
};
