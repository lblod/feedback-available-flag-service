import {app, errorHandler} from 'mu';
import Delta from "./src/model/delta.js";
import DeltaService from "./src/service/delta-service.js";
import InstanceRepository from "./src/repository/instance-repository.js";
import PublishRepository from "./src/repository/publish-repository.js";

import {CronJob} from 'cron';
import bodyParser from 'body-parser';
import {
    DEBUG, ERROR_EXPIRATION_MONTHS,
    HEALING_CRON,
    INGEST_CRON,
    INSTANCE_PREDICATE,
    INSTANCE_TYPE, IPDC_JSON_ENDPOINT,
    IPDC_STATUS_PREDICATE,
    IPDC_STATUS_START_URI, IPDC_X_API_KEY,
    LDES_GRAPH,
    LPDC_STATUS_END_URI,
    LPDC_STATUS_PREDICATE,
    LPDC_STATUS_START_URI,
    PUBLISH_CRON,
    RETRY_COUNTER_LIMIT,
    UNKNOWN_GRAPH
} from './env.js';
import LdesRepository from "./src/repository/ldes-repository.js";
import LdesService from "./src/service/ldes-service.js";
import {isOvoUri} from "./src/utils/uri-utils.js";

console.log('lpdc feedback management service starting...');
if (DEBUG) {
    console.log('Debug mode enabled');
    console.log(`HEALING_CRON: ${HEALING_CRON}`);
    console.log(`INGEST_CRON: ${INGEST_CRON}`);
    console.log(`IPDC_STATUS_PREDICATE: ${IPDC_STATUS_PREDICATE}`);
    console.log(`IPDC_STATUS_START_URI: ${IPDC_STATUS_START_URI}`);
    console.log(`INSTANCE_TYPE: ${INSTANCE_TYPE}`);
    console.log(`INSTANCE_PREDICATE: ${INSTANCE_PREDICATE}`);
    console.log(`LPDC_STATUS_START_URI: ${LPDC_STATUS_START_URI}`);
    console.log(`LPDC_STATUS_END_URI: ${LPDC_STATUS_END_URI}`);
    console.log(`LPDC_STATUS_PREDICATE: ${LPDC_STATUS_PREDICATE}`);
    console.log(`LDES_GRAPH: ${LDES_GRAPH}`);
    console.log(`UNKNOWN_GRAPH: ${UNKNOWN_GRAPH}`);
    console.log(`PUBLISH_CRON: ${PUBLISH_CRON}`);
    console.log(`RETRY_COUNTER_LIMIT: ${RETRY_COUNTER_LIMIT}`);
    console.log(`ERROR_EXPIRATION_MONTHS: ${ERROR_EXPIRATION_MONTHS}`);
    console.log(`IPDC_JSON_ENDPOINT: ${IPDC_JSON_ENDPOINT}`);
    console.log(`IPDC_X_API_KEY: ${IPDC_X_API_KEY}`);
}

app.use(bodyParser.json());
app.use(errorHandler);

let publishInProgress = false;

/**
 * Handles publishing feedback to IPDC:
 */
async function handlePublish() {
    try {
        console.log('Publish process start');
        const feedbackToPublish = await PublishRepository.getFeedbackToPublish();
        console.log(`Found ${feedbackToPublish.length} to publish`);
        await PublishRepository.clearPublicationErrors();

        for (const feedback of feedbackToPublish) {
            try {
                if(!isOvoUri(feedback.payload.antwoord.van)){
                    feedback.payload.antwoord.van = await PublishRepository.findOvoConceptFromBestuurseenheid(feedback.payload.antwoord.van);
                }
                await PublishRepository.sendFeedbackToIpdc(feedback.payload);
                await PublishRepository.updateFeedbackOnSucces(feedback.payload.feedbackId);
                console.log(`Successfully published feedback ${feedback.payload.feedbackId} to ipdc`);
            } catch (e) {
                await PublishRepository.incrementRetryCounter(feedback.payload.feedbackId);
                const retriesLeft = RETRY_COUNTER_LIMIT - (feedback.retryCount ?? 0) - 1;
                console.error(
                    `Could not publish ${feedback.payload.feedbackId}, ${retriesLeft} ${retriesLeft === 1 ? "retry" : "retries"} left${
                        retriesLeft === 0 ? ", giving up" : ""
                    }. Error: `,
                    e
                );
            }
        }
    } catch (e) {
        console.error('General error fetching data, retrying later');
        console.log(e);
    }
}

/**
 * cronjob for handling feedback publishing to IPDC
 */
new CronJob(
    PUBLISH_CRON,
    async function () {
        if (publishInProgress) {
            console.log('Publish process already in progress');
            return;
        }
        try {
            publishInProgress = true;
            await handlePublish();
        } finally {
            publishInProgress = false;
        }
    },
    null,
    true,
);


/**
 * Handles ldes ingesting:
 */
async function handleLdesIngest() {
    try {
        let feedbackUris = await LdesRepository.findToProcessSnapshots()

        console.log(`Found ${feedbackUris.length} snapshots to process`);

        if (feedbackUris.length) {
            LdesService.process(feedbackUris)
                .catch(e => {
                    console.log(`Something went wrong while processing snapshots`);
                    console.error(e);
                });
        }

        console.log('Started ldes ingest');
    } catch (error) {
        console.error('Error ldes ingesting:', error);
        throw error;
    }
}

/**
 * cronjob for handling feedback ldes ingesting
 */
new CronJob(
    INGEST_CRON,
    async function () {
        console.log(
            `Handling feedback ldes ingesting at ${new Date().toISOString()}`,
        );
        await handleLdesIngest();
    },
    null,
    true,
);

/**
 * Handle missed deltas by fixing inconsistent data states.
 * 1. Sets lpdc-status to START for feedbacks with status ipdc-status AANGEMAAKT but missing lpdc-status.
 * 2. Finds instances flagged true but without a link to the expected ipdc-status and unflags them.
 * 3. Finds instances flagged false but linked to the expected ipdc-status and flags them.
 */
async function handleMissedDeltas() {
    try {
        console.log('Starting missed deltas healing...');

        const feedbacksWithNoLpdcStatus = await InstanceRepository.findFeedbacksMissingLpdcStatus();
        if (DEBUG) {
            console.log(`Found ${feedbacksWithNoLpdcStatus.length} feedbacks missing lpdc-status`);
        }
        if (feedbacksWithNoLpdcStatus.length > 0) {
            await Promise.allSettled(
                feedbacksWithNoLpdcStatus.map(feedback => InstanceRepository.setLpdcStatus(feedback))
            );
            console.log(`Successfully set lpdc-status for ${feedbacksWithNoLpdcStatus.length} feedbacks.`);
        }

        const incorrectlyFlaggedInstances = await InstanceRepository.findIncorrectlyFlaggedInstances();
        if (DEBUG) {
            console.log(`Found ${incorrectlyFlaggedInstances.length} incorrectly flagged instances (should be false)`);
        }
        if (incorrectlyFlaggedInstances.length > 0) {
            await Promise.allSettled(
                incorrectlyFlaggedInstances.map(instance => InstanceRepository.updateInstanceFlagged(instance, false))
            );
            console.log(`Successfully unflagged ${incorrectlyFlaggedInstances.length} instances.`);
        }

        const unflaggedInstances = await InstanceRepository.findUnflaggedInstancesWithStatus();
        if (DEBUG) {
            console.log(`Found ${unflaggedInstances.length} unflagged instances (should be true)`);
        }
        if (unflaggedInstances.length > 0) {
            await Promise.allSettled(
                unflaggedInstances.map(instance => InstanceRepository.updateInstanceFlagged(instance, true))
            );
            console.log(`Successfully flagged ${unflaggedInstances.length} instances.`);
        }

        console.log('Missed deltas healing complete.');
    } catch (error) {
        console.error('Error during missed deltas healing:', error);
        throw error;
    }
}

/**
 * cronjob for handling missed delta's
 */
new CronJob(
    HEALING_CRON,
    async function () {
        console.log(
            `Missed delta's healing triggered by cron job at ${new Date().toISOString()}`,
        );
        await handleMissedDeltas();
    },
    null,
    true,
);

/**
 * Delta endpoint
 */
app.post('/delta-ingest', (req, res) => {
    if (DEBUG) {
        console.log('--- Delta ingest received ---');
        console.log('Delta body:', JSON.stringify(req.body, null, 2));
    }

    let newSnapshotInsertURIs = new Delta(req.body).getInsertsForLdes();

    if (DEBUG) {
        console.log(`Extracted ${newSnapshotInsertURIs.length} new snapshot URIs:`, newSnapshotInsertURIs);
    }

    if (!newSnapshotInsertURIs) {
        console.log('Delta did not contain any new snapshots in the ldes graph, awaiting the next batch!');
        return res.status(204).send();
    }

    if (newSnapshotInsertURIs.length) {
        LdesService.process(newSnapshotInsertURIs)
            .catch(e => {
                console.log(`Something went wrong while processing new snapshot deltas`);
                console.error(e);
            });
    }

    console.log('Started processing delta ingest, awaiting the next batch!');
    return res.status(204).send().end();
});

/**
 * Delta endpoint
 */
app.post('/delta-status-start', (req, res) => {
    if (DEBUG) {
        console.log('--- Delta status start received ---');
        console.log('Delta body:', JSON.stringify(req.body, null, 2));
    }

    let newFeedbackInsertURIs = new Delta(req.body).getInsertsFor(
        IPDC_STATUS_PREDICATE, IPDC_STATUS_START_URI);

    if (DEBUG) {
        console.log(`Extracted ${newFeedbackInsertURIs.length} new feedback URIs:`, newFeedbackInsertURIs);
    }

    if (!newFeedbackInsertURIs.length) {
        console.log('Delta did not contain any new feedback in start status, awaiting the next batch!');
        return res.status(204).send();
    }

    if (newFeedbackInsertURIs.length) {
        DeltaService.process(newFeedbackInsertURIs, true)
            .catch(e => {
                console.log(`Something went wrong while processing new feedback deltas`);
                console.error(e);
            });
    }

    console.log('Started processing status start delta, awaiting the next batch!');
    return res.status(204).send().end();
});

/**
 * Delta endpoint
 */
app.post('/delta-status-end', (req, res) => {
    if (DEBUG) {
        console.log('--- Delta status end received ---');
        console.log('Delta body:', JSON.stringify(req.body, null, 2));
    }

    let processedFeedbackInsertURIs = new Delta(req.body).getInsertsFor(
        LPDC_STATUS_PREDICATE, LPDC_STATUS_END_URI);

    if (DEBUG) {
        console.log(`Extracted ${processedFeedbackInsertURIs.length} processed feedback URIs:`, processedFeedbackInsertURIs);
    }

    if (!processedFeedbackInsertURIs.length) {
        console.log('Delta did not contain any processed feedback, awaiting the next batch!');
        return res.status(204).send();
    }

    if (processedFeedbackInsertURIs.length) {
        DeltaService.process(processedFeedbackInsertURIs, false)
            .catch(e => {
                console.log(`Something went wrong while processing processed feedback deltas`);
                console.error(e);
            });
    }

    console.log('Started processing status end delta, awaiting the next batch!');
    return res.status(204).send().end();
});


/**
 * Health check
 */
app.get('/', (req, res) => {
    res.send("Hello, you've reached the lpdc-feedback-management-service.");
});