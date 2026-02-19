import LdesRepository from '../repository/ldes-repository.js';
import OrganizationRepository from '../repository/organization-repository.js';
import {isOvoUri} from "../utils/uri-utils";
import {DEBUG} from "../../env";

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
                const feedbackUri = await LdesRepository.getFeedbackUri(snapshotUri);
                const lpdcFeedbackOrganizationGraph = await LdesRepository.checkIfFeedbackInLpdcData(feedbackUri);
                if (lpdcFeedbackOrganizationGraph) {
                    await LdesRepository.updateFeedbackInOrganizationGraph(feedbackUri, lpdcFeedbackOrganizationGraph);
                } else {
                    await LdesService.createNewFeedbackFromSnapshot(snapshotUri, feedbackUri)
                }
                await LdesRepository.markSnapshotAsProcessed(snapshotUri);
                console.log(`✓ Successfully processed snapshot: ${snapshotUri}`);
            } catch (error) {
                console.error(`✗ Error processing snapshot ${snapshotUri}:`, error);
            }
        }

        console.log(`Completed processing ${snapshotUris.length} snapshots.`);
    };


    /**
     * Create a new feedback object in lpdc data based on the ldes snapshot.
     */
    static createNewFeedbackFromSnapshot = async function (snapshotUri, feedbackUri) {
        const recipientConcept = await LdesService.ensureOrganizationConcepts(snapshotUri);
        const bestuurseenheid = await LdesService.findOrganizationGraph(recipientConcept);
        await LdesRepository.copyFeedbackToOrganizationGraph(feedbackUri, bestuurseenheid.uri, bestuurseenheid.graph);
    };

    /**
     * Ensure organization concepts exist
     * - Extract question sender/recipient URIs from snapshot
     * - Check for ovo concepts that they exist, create if missing
     */
    static ensureOrganizationConcepts = async function (snapshotUri) {
        const organizationUris = await LdesRepository.extractOrganizationUris(snapshotUri);

        let recipientConcept
        if (isOvoUri(organizationUris.recipient)) {
            recipientConcept = await LdesService.ensureOvoConceptExists(organizationUris.recipient);
            if (DEBUG) {
                console.log(`  ✓ Recipient concept: ${recipientConcept.label} (OVO: ${recipientConcept.notation})`);
            }
        } else {
            recipientConcept = {
                uri: organizationUris.recipient,
                label: null,
                notation: null

            };
        }

        let senderConcept
        if (isOvoUri(organizationUris.sender)) {
            senderConcept = await LdesService.ensureOvoConceptExists(organizationUris.sender);
            if (DEBUG) {
                console.log(`  ✓ Sender concept: ${senderConcept.label} (OVO: ${senderConcept.notation})`);
            }
        }
        return recipientConcept;

    };

    /**
     * Ensure an organization concept exists with complete data (prefLabel and notation).
     * 1. Check if it exists as skos:Concept with both prefLabel and notation
     * 2. If concept exists but missing notation, fetch from data.vlaanderen.be and update
     * 3. If concept doesn't exist, fetch from data.vlaanderen.be and create concept
     */
    static ensureOvoConceptExists = async function (organizationUri) {
        if (!organizationUri)
            throw 'organizationUri cannot be null.';

        let concept = await OrganizationRepository.findConceptByUri(organizationUri);

        if (concept) {
            if (concept.notation) {
                // concept exists in lpdc data with label and notation
                return concept;
            } else {
                // concept exists in lpdc data but without ovo notation
                const orgData = await OrganizationRepository.fetchFromDataVlaanderen(organizationUri);
                return await OrganizationRepository.updateOvoConceptWithNotation(organizationUri, orgData);
            }
        }
        // concept not found in lpdc data
        const orgData = await OrganizationRepository.fetchFromDataVlaanderen(organizationUri);
        return await OrganizationRepository.createConcept(orgData.uri, orgData.label, orgData.notation);
    };

    /**
     * Part 2: Find organization graph
     * - Start from recipient's OVO notation
     * - Find bestuurseenheid
     * - Get organization graph
     */
    static findOrganizationGraph = async function (recipientConcept) {
        let bestuurseenheid;
        if (isOvoUri(recipientConcept.uri)) {
            bestuurseenheid = await OrganizationRepository.findBestuurseenheidByOvoCode(recipientConcept.notation);
        } else {
            bestuurseenheid = await OrganizationRepository.findBestuurseenheidByUri(recipientConcept.uri);
        }

        if (!bestuurseenheid) {
            // OVO code geen link naar bestaandebestuurseenheid -> discarden + extra status unkown recipient
            throw `  ✗ No bestuurseenheid found for: ${recipientConcept}`
        }

        if (DEBUG) {
            console.log(`  ✓ Bestuurseenheid: ${bestuurseenheid.label}`);
            console.log(`  ✓ Organization graph: ${bestuurseenheid.graph}`);
        }

        return bestuurseenheid;
    };
}

export default LdesService;