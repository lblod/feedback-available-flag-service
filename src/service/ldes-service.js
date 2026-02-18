import LdesRepository from '../repository/ldes-repository.js';
import OrganizationRepository from '../repository/organization-repository.js';
import {isOvoUri} from "../utils/uri-utils";

class LdesService {

    /**
     * Process the given list of snapshot URIs.
     */
    static process = async function (snapshotUris) {
        if (!snapshotUris || snapshotUris.length === 0) {
            console.log('No snapshots to process.');
            return;
        }

        console.log(`Processing ${snapshotUris.length} snapshots...`);

        for (const snapshotUri of snapshotUris) {
            try {
                console.log(`\n--- Processing snapshot: ${snapshotUri} ---`);

                // Part 1: Ensure concepts exist + return recipientConcept for graph calculation
                const recipientConcept = await LdesService._ensureOrganizationConcepts(snapshotUri);

                // Part 2: Find organization graph
                const bestuurseenheid = await LdesService._findOrganizationGraph(recipientConcept);
                if (!bestuurseenheid) {
                    console.warn('Skipping snapshot - cannot determine organization graph.');
                    continue;
                }

                // Part 3: Ingest snapshot data and mark as processed
                await LdesService._ingestSnapshotData(snapshotUri, bestuurseenheid);

                console.log(`✓ Successfully processed snapshot: ${snapshotUri}`);

            } catch (error) {
                console.error(`✗ Error processing snapshot ${snapshotUri}:`, error);
            }
        }

        console.log(`\nCompleted processing ${snapshotUris.length} snapshots.`);
    };

    /**
     * Part 1: Ensure organization concepts exist
     * - Extract sender/recipient URIs from snapshot
     * - Check if concepts exist, create if missing
     * - Update with OVO notation if needed
     */
    static _ensureOrganizationConcepts = async function (snapshotUri) {
        console.log('\n[Part 1] Ensuring organization concepts exist...');

        // Extract organization URIs from snapshot
        const organizationUris = await LdesRepository.extractOrganizationUris(snapshotUri);
        console.log(`  Sender: ${organizationUris.sender}`);
        console.log(`  Recipient: ${organizationUris.recipient}`);

        let recipientConcept
        // Ensure recipient concept exists
        if (isOvoUri(organizationUris.recipient)) {
            recipientConcept = await OrganizationRepository.ensureConceptExists(organizationUris.recipient);
            console.log(`  ✓ Recipient concept: ${recipientConcept.label} (OVO: ${recipientConcept.notation})`);
        }
        else{
            recipientConcept =  {
                uri: organizationUris.recipient,
                label: organizationUris.recipient,
                notation: organizationUris.recipient
            };
        }

        let senderConcept
        // Ensure sender concept exists
        if (isOvoUri(organizationUris.sender)) {
            senderConcept = await OrganizationRepository.ensureConceptExists(organizationUris.sender);
            console.log(`  ✓ Sender concept: ${senderConcept.label} (OVO: ${senderConcept.notation})`);
        }
        return recipientConcept;

    };

    /**
     * Part 2: Find organization graph
     * - Start from recipient's OVO notation
     * - Find bestuurseenheid
     * - Get organization graph
     */
    static _findOrganizationGraph = async function (recipientConcept) {
        console.log('\n[Part 2] Finding organization graph...');

        let bestuurseenheid;
        if (isOvoUri(recipientConcept.uri)) {
            bestuurseenheid = await OrganizationRepository.findBestuurseenheidByOvoCode(recipientConcept.notation);
        } else {
            bestuurseenheid = await OrganizationRepository.findBestuurseenheidByUri(recipientConcept.uri);
        }

        if (!bestuurseenheid) {
            console.warn(`  ✗ No bestuurseenheid found for: ${recipientConcept}`);
            return null;
        }

        console.log(`  ✓ Bestuurseenheid: ${bestuurseenheid.label}`);
        console.log(`  ✓ Organization graph: ${bestuurseenheid.graph}`);

        return bestuurseenheid;
    };

    /**
     * Part 3: Ingest snapshot data and mark as processed
     * - Retrieve snapshot data
     * - Move to organization graph
     * - Mark snapshot as processed
     */
    static _ingestSnapshotData = async function (snapshotUri, bestuurseenheid) {
        console.log('\n[Part 3] Ingesting snapshot data...');

        // Get the feedback URI from the snapshot
        const feedbackUri = await LdesRepository.getFeedbackUri(snapshotUri);
        console.log(`  Feedback URI: ${feedbackUri}`);

        // Copy all feedback data (including nested structures) to organization graph
        await LdesRepository.copyFeedbackToOrganizationGraph(feedbackUri, bestuurseenheid.graph);

        // Mark snapshot as processed
        await LdesRepository.markSnapshotAsProcessed(snapshotUri);
        console.log(`  ✓ Snapshot marked as processed`);
    };
}

export default LdesService;