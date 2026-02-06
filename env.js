import env from 'env-var';

const STATUS_PREDICATE = env.get('STATUS_PREDICATE').default('http://www.w3.org/ns/adms#status').asString();
const STATUS_URI = env.get('STATUS_URI').default('https://ipdc.vlaanderen.be/ns/FeedbackStatus#AANGEMAAKT').asString();
const INSTANCE_TYPE = env.get('INSTANCE_TYPE').default('https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#InstancePublicService').asString();
const INSTANCE_PREDICATE = env.get('INSTANCE_PREDICATE').default('http://www.w3.org/2004/02/skos/core#primarySubject').asString();
const HEALING_CRON = env.get('HEALING_CRON').default('0 3 * * *').asString();
const DEBUG = env.get('DEBUG').default('false').asBool();

export { STATUS_PREDICATE, STATUS_URI, INSTANCE_TYPE, INSTANCE_PREDICATE, HEALING_CRON, DEBUG };
