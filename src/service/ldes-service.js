import LdesRepository from '../repository/ldes-repository.js';
import OrganizationRepository from '../repository/organization-repository.js';
import {isOvoUri} from "../utils/uri-utils";
import {DEBUG} from "../../env";

class LdesService {

    /**
     * Process the given list of snapshot URIs.
     */
    static process = async function (feedbackUris) {
        if (!feedbackUris || feedbackUris.length === 0) {
            console.log('No snapshots to process.');
            return;
        }

        for (const feedbackUri of feedbackUris) {
            try {
                console.log(`\n--- Processing snapshot: ${feedbackUri} ---`);
                const lpdcFeedbackOrganizationGraph = await LdesRepository.checkIfFeedbackInLpdcData(feedbackUri);
                if (lpdcFeedbackOrganizationGraph) {
                    await LdesRepository.updateFeedbackInOrganizationGraph(feedbackUri, lpdcFeedbackOrganizationGraph);
                } else {
                    await LdesService.createNewFeedbackFromSnapshot(feedbackUri)
                }
                console.log(`✓ Successfully processed snapshot: ${feedbackUri}`);
            } catch (error) {
                console.error(`✗ Error processing snapshot ${feedbackUri}:`, error);
            }
        }

        console.log(`Completed processing ${feedbackUris.length} snapshots.`);
    };


    /**
     * Create a new feedback object in lpdc data based on the ldes snapshot.
     */
    static createNewFeedbackFromSnapshot = async function (feedbackUri) {
        const recipientConcept = await LdesService.ensureOrganizationConcepts(feedbackUri);
        const bestuurseenheid = await LdesService.findOrganizationGraph(recipientConcept, feedbackUri);
        await LdesRepository.copyFeedbackToOrganizationGraph(feedbackUri, bestuurseenheid.uri, bestuurseenheid.graph);
        await LdesRepository.removeFeedbackFromUnknownGraph(feedbackUri);
    };

    /**
     * Ensure organization concepts exist
     * - Extract question sender/recipient URIs from snapshot
     * - Check for ovo concepts that they exist, create if missing
     */
    static ensureOrganizationConcepts = async function (feedbackUri) {
        const organizationUris = await LdesRepository.extractOrganizationUris(feedbackUri);

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
    static findOrganizationGraph = async function (recipientConcept, feedbackUri) {
        let bestuurseenheid;
        if (isOvoUri(recipientConcept.uri)) {
            bestuurseenheid = await OrganizationRepository.findBestuurseenheidByOvoCode(recipientConcept.notation);
        } else {
            bestuurseenheid = await OrganizationRepository.findBestuurseenheidByUri(recipientConcept.uri);
        }

        if (!bestuurseenheid) {
            await LdesRepository.addFeedbackToUnknownGraph(feedbackUri)
            throw `  ✗ No bestuurseenheid found for: ${recipientConcept} added ${feedbackUri} to the unknown graph `
        }

        if (DEBUG) {
            console.log(`  ✓ Bestuurseenheid: ${bestuurseenheid.label}`);
            console.log(`  ✓ Organization graph: ${bestuurseenheid.graph}`);
        }

        return bestuurseenheid;
    };
}

export default LdesService;