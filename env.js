import env from 'env-var';

const STATUS_PREDICATE = env.get('STATUS_PREDICATE').default('http://www.w3.org/ns/adms#status').asString();
const STATUS_START_URI = env.get('STATUS_START_URI').default('https://ipdc.vlaanderen.be/ns/FeedbackStatus#AANGEMAAKT').asString();
const STATUS_END_URI = env.get('STATUS_END_URI').default('https://ipdc.vlaanderen.be/ns/FeedbackStatus#BEANTWOORD').asString();

const INSTANCE_PREDICATE = env.get('INSTANCE_PREDICATE').default('http://www.w3.org/2004/02/skos/core#primarySubject').asString();
const INSTANCE_TYPE = env.get('INSTANCE_TYPE').default('https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#InstancePublicService').asString();

const PROCESSING_STATUS_PREDICATE = env.get('PROCESSING_STATUS_PREDICATE').default('https://schema.org/actionStatus').asString();
const PROCESSING_STATUS_START_URI = env.get('PROCESSING_STATUS_START_URI').default('http://lblod.data.gift/concepts/1b3c5e7f-2a4d-4c6e-9f1b-3d5a7c9e2f4b').asString();
const PROCESSING_STATUS_END_URI = env.get('PROCESSING_STATUS_END_URI').default('http://lblod.data.gift/concepts/2e4a6c8d-9f1b-4d3e-5a7c-9e1f3b5d7a9c').asString();


const HEALING_CRON = env.get('HEALING_CRON').default('0 3 * * *').asString();
const DEBUG = env.get('DEBUG').default('false').asBool();


export { STATUS_PREDICATE, STATUS_START_URI, STATUS_END_URI, INSTANCE_PREDICATE, INSTANCE_TYPE, PROCESSING_STATUS_PREDICATE, PROCESSING_STATUS_START_URI, PROCESSING_STATUS_END_URI, HEALING_CRON, DEBUG };
