import {app} from 'mu';
import Delta from "./src/model/delta";
import DeltaService from "./src/service/delta-service";
import InstanceRepository from "./src/repository/instance-repository";
import {CronJob} from 'cron';
import bodyParser from 'body-parser';
import {DEBUG, HEALING_CRON, INSTANCE_PREDICATE, INSTANCE_TYPE, STATUS_PREDICATE, STATUS_URI} from './env';

console.log('Feedback Available Flag Service starting...');
if (DEBUG) {
    console.log('Debug mode enabled');
    console.log(`STATUS_URI: ${STATUS_URI}`);
    console.log(`STATUS_PREDICATE: ${STATUS_PREDICATE}`);
    console.log(`INSTANCE_TYPE: ${INSTANCE_TYPE}`);
    console.log(`INSTANCE_PREDICATE: ${INSTANCE_PREDICATE}`);
    console.log(`HEALING_CRON: ${HEALING_CRON}`);
}
app.use(bodyParser.json());

/**
 * Handle missed deltas by fixing incorrectly flagged instances.
 * 1. Finds instances flagged true but without a link to the expected status and unflags them.
 * 2. Finds instances flagged false but linked to the expected status and flags them.
 */
async function handleMissedDeltas() {
    try {
        console.log('Starting missed deltas healing...');

        const incorrectlyFlaggedInstances = await InstanceRepository.findIncorrectlyFlaggedInstances(STATUS_PREDICATE, STATUS_URI);
        if (DEBUG) {
            console.log(`Found ${incorrectlyFlaggedInstances.length} incorrectly flagged instances (should be false)`);
        }
        if (incorrectlyFlaggedInstances.length > 0) {
            await Promise.allSettled(
                incorrectlyFlaggedInstances.map(instance => InstanceRepository.updateInstanceFlagged(instance, false))
            );
            console.log(`Successfully unflagged ${incorrectlyFlaggedInstances.length} instances.`);
        }

        const unflaggedInstances = await InstanceRepository.findUnflaggedInstancesWithStatus(STATUS_PREDICATE, STATUS_URI);
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

    let feedbackInsertURIs = new Delta(req.body).getInsertsFor(
        STATUS_PREDICATE, STATUS_URI);

    let feedbackDeleteURIs = new Delta(req.body).getDeletesFor(
        STATUS_PREDICATE, STATUS_URI);

    if (DEBUG) {
        console.log(`Extracted ${feedbackInsertURIs.length} insert URIs:`, feedbackInsertURIs);
        console.log(`Extracted ${feedbackDeleteURIs.length} delete URIs:`, feedbackDeleteURIs);
    }

    if (!feedbackInsertURIs.length && !feedbackDeleteURIs.length) {
        console.log('Delta did not contain any feedback status changes, awaiting the next batch!');
        return res.status(204).send();
    }

    if (feedbackInsertURIs.length) {
        DeltaService.process(feedbackInsertURIs, true)
            .catch(e => {
                console.log(`Something went wrong while processing insert delta`);
                console.error(e);
            });
    }

    if (feedbackDeleteURIs.length) {
        DeltaService.process(feedbackDeleteURIs, false)
            .catch(e => {
                console.log(`Something went wrong while processing delete delta`);
                console.error(e);
            });
    }

    console.log('Started processing delta, awaiting the next batch!');
    return res.status(204).send().end();
});