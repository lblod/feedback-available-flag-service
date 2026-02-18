import {app} from 'mu';
import Delta from "./src/model/delta.js";
import DeltaService from "./src/service/delta-service.js";
import InstanceRepository from "./src/repository/instance-repository.js";

import {CronJob} from 'cron';
import bodyParser from 'body-parser';
import {
    DEBUG,
    HEALING_CRON,
    INSTANCE_PREDICATE,
    INSTANCE_TYPE,
    IPDC_STATUS_PREDICATE,
    IPDC_STATUS_START_URI,
    LPDC_STATUS_PREDICATE,
    LPDC_STATUS_START_URI, LPDC_STATUS_END_URI, IPDC_STATUS_END_URI, INGEST_CRON
} from './env.js';
import LdesRepository from "./src/repository/ldes-repository.js";
import LdesService from "./src/service/ldes-service.js";

console.log('Feedback Available Flag Service starting...');
if (DEBUG) {
    console.log('Debug mode enabled');
    console.log(`HEALING_CRON: ${HEALING_CRON}`);

    console.log(`IPDC_STATUS_PREDICATE: ${IPDC_STATUS_PREDICATE}`);
    console.log(`IPDC_STATUS_START_URI: ${IPDC_STATUS_START_URI}`);
    console.log(`IPDC_STATUS_END_URI: ${IPDC_STATUS_END_URI}`);

    console.log(`INSTANCE_TYPE: ${INSTANCE_TYPE}`);
    console.log(`INSTANCE_PREDICATE: ${INSTANCE_PREDICATE}`);

    console.log(`LPDC_STATUS_START_URI: ${LPDC_STATUS_START_URI}`);
    console.log(`LPDC_STATUS_END_URI: ${LPDC_STATUS_END_URI}`);
    console.log(`LPDC_STATUS_PREDICATE: ${LPDC_STATUS_PREDICATE}`);
}
app.use(bodyParser.json());

/**
 * Handle missed deltas by fixing inconsistent data states.
 * 1. Sets lpdc-status to START for feedbacks with status ipdc-status AANGEMAAKT but missing lpdc-status.
 * 2. Sets ipdc-status to BEANTWOORD for feedbacks with lpdc-status VERWERKT.
 * 3. Finds instances flagged true but without a link to the expected ipdc-status and unflags them.
 * 4. Finds instances flagged false but linked to the expected ipdc-status and flags them.
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

        const feedbacksNeedingFinish = await InstanceRepository.findMissedFeedbacksWithEndLpdcStatus();
        if (DEBUG) {
            console.log(`Found ${feedbacksNeedingFinish.length} feedbacks with END lpdc-status but not finished`);
        }
        if (feedbacksNeedingFinish.length > 0) {
            await Promise.allSettled(
                feedbacksNeedingFinish.map(feedback => InstanceRepository.finishFeedback(feedback))
            );
            console.log(`Successfully finished ${feedbacksNeedingFinish.length} feedbacks.`);
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
 * Handles ldes ingesting:
 */
async function handleLdesIngest() {
    try {
        console.log('Starting ldes ingesting...');

        let snapshotsURIs = await LdesRepository.findToProcessSnapshots()

        console.log(`Found ${snapshotsURIs.length} snapshots to process`);
        console.log(snapshotsURIs);

        if (snapshotsURIs.length) {
            LdesService.process(snapshotsURIs)
                .catch(e => {
                    console.log(`Something went wrong while processing snapshots`);
                    console.error(e);
                });
        }

        console.log('Ldes ingest complete.');
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
 * Health check
 */
app.get('/', (req, res) => {
    res.send("Hello, you've reached the feedback-available-flag-service.");
});

/**
 * Delta endpoint
 */
app.post('/delta', (req, res) => {
    if (DEBUG) {
        console.log('--- Delta received ---');
        console.log('Delta body:', JSON.stringify(req.body, null, 2));
    }

    let newFeedbackInsertURIs = new Delta(req.body).getInsertsFor(
        IPDC_STATUS_PREDICATE, IPDC_STATUS_START_URI);

    let processedFeedbackInsertURIs = new Delta(req.body).getInsertsFor(
        LPDC_STATUS_PREDICATE, LPDC_STATUS_END_URI);

    if (DEBUG) {
        console.log(`Extracted ${newFeedbackInsertURIs.length} new feedback URIs:`, newFeedbackInsertURIs);
        console.log(`Extracted ${processedFeedbackInsertURIs.length} processed feedback URIs:`, processedFeedbackInsertURIs);
    }

    if (!newFeedbackInsertURIs.length && !processedFeedbackInsertURIs.length) {
        console.log('Delta did not contain any feedback status changes, awaiting the next batch!');
        return res.status(204).send();
    }

    if (newFeedbackInsertURIs.length) {
        DeltaService.process(newFeedbackInsertURIs, true)
            .catch(e => {
                console.log(`Something went wrong while processing new feedback deltas`);
                console.error(e);
            });
    }

    if (processedFeedbackInsertURIs.length) {
        DeltaService.process(processedFeedbackInsertURIs, false)
            .catch(e => {
                console.log(`Something went wrong while processing processed feedback delta`);
                console.error(e);
            });
    }

    console.log('Started processing delta, awaiting the next batch!');
    return res.status(204).send().end();
});