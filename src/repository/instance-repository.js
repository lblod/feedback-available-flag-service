import {sparqlEscapeUri, sparqlEscapeBool} from 'mu';
import {querySudo as query, updateSudo as update} from '@lblod/mu-auth-sudo';
import {
    INSTANCE_TYPE,
    INSTANCE_PREDICATE,
    LPDC_STATUS_START_URI,
    LPDC_STATUS_PREDICATE,
    IPDC_STATUS_PREDICATE,
    IPDC_STATUS_START_URI, LPDC_STATUS_END_URI, LDES_GRAPH, UNKNOWN_GRAPH
} from '../../env';


class InstanceRepository {

    /**
     * Find instance to flag that is linked to given feedback uri.
     *
     */
    static findInstanceByURI = async function (uri) {
        if (!uri)
            throw new Error('uri can not be null.');
        const result = await query(`
      PREFIX schema2: <https://schema.org/>
      
      SELECT DISTINCT ?instance WHERE {
        VALUES ?uri { ${sparqlEscapeUri(uri)} }
        ?uri a schema2:Conversation.
        ?uri ${sparqlEscapeUri(INSTANCE_PREDICATE)} ?instance
      }
    `);
        if (result.results.bindings.length === 0)
            throw new Error(`URI <${uri}> is not linked to an instance, data corrupt?`);
        if (result.results.bindings.length > 1)
            throw new Error(`multiple results exists while doing lookup on URI <${uri}>, data corrupt?`);
        return result.results.bindings[0].instance.value;
    };

    /**
     * Updates the flagged property on an instance with given uri.
     *
     */
    static updateInstanceFlagged = async function (instanceUri, flagged) {
        if (!instanceUri)
            throw new Error('instanceUri can not be null.');

        await update(`
      PREFIX lpdcExt: <https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#>

      DELETE {
        GRAPH ?g {
            ${sparqlEscapeUri(instanceUri)} lpdcExt:feedbackAvailable ?oldValue .
        }
      }
      INSERT {
        GRAPH ?g {
            ${sparqlEscapeUri(instanceUri)} lpdcExt:feedbackAvailable ${sparqlEscapeBool(flagged)} .
        }
      }
      WHERE {
        GRAPH ?g {
        ${sparqlEscapeUri(instanceUri)} a ${sparqlEscapeUri(INSTANCE_TYPE)}.
        OPTIONAL { ${sparqlEscapeUri(instanceUri)} lpdcExt:feedbackAvailable ?oldValue . }
        }
      }
    `);
    };

    /**
     * Set the ldpc-status of given feedbackUri based on its ipdc-status.
     * Sets to LPDC_STATUS_START_URI if ipdc-status is IPDC_STATUS_START_URI,
     * otherwise sets to LPDC_STATUS_END_URI.
     * Only sets if no lpdc-status already exists.
     */
    static setLpdcStatus = async function (feedbackUri) {
        if (!feedbackUri)
            throw new Error('feedbackUri can not be null.');

        await update(`
      INSERT {
        GRAPH ?g {
            ${sparqlEscapeUri(feedbackUri)} ${sparqlEscapeUri(LPDC_STATUS_PREDICATE)} ?lpdcStatusToSet  .
        }
      }
      WHERE {
        GRAPH ?g {
        ${sparqlEscapeUri(feedbackUri)} a ${sparqlEscapeUri("https://schema.org/Conversation")}.
        ${sparqlEscapeUri(feedbackUri)} ${sparqlEscapeUri(IPDC_STATUS_PREDICATE)} ?ipdcStatus.
        OPTIONAL { ${sparqlEscapeUri(feedbackUri)} ${sparqlEscapeUri(LPDC_STATUS_PREDICATE)} ?oldValue . }

        BIND(IF(?ipdcStatus = ${sparqlEscapeUri(IPDC_STATUS_START_URI)},
                ${sparqlEscapeUri(LPDC_STATUS_START_URI)},
                ${sparqlEscapeUri(LPDC_STATUS_END_URI)}) AS ?lpdcStatusToSet)
        }

        FILTER(?g != ${sparqlEscapeUri(LDES_GRAPH)} && ?g != ${sparqlEscapeUri(UNKNOWN_GRAPH)})
        FILTER(!BOUND(?oldValue))
      }
    `);
    };

    /**
     * Find all instances that are flagged true but don't have any active feedbacks.
     */
    static findIncorrectlyFlaggedInstances = async function () {
        const result = await query(`
      PREFIX schema2: <https://schema.org/>
      PREFIX lpdcExt: <https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#>

      SELECT DISTINCT ?instance WHERE {
        ?instance a ${sparqlEscapeUri(INSTANCE_TYPE)}.
        ?instance lpdcExt:feedbackAvailable ${sparqlEscapeBool(true)}.
        FILTER NOT EXISTS {
          ?feedback a schema2:Conversation.
          ?feedback ${sparqlEscapeUri(INSTANCE_PREDICATE)} ?instance.
          ?feedback ${sparqlEscapeUri(IPDC_STATUS_PREDICATE)} ${sparqlEscapeUri(IPDC_STATUS_START_URI)}.
          FILTER NOT EXISTS {
            ?feedback ${sparqlEscapeUri(LPDC_STATUS_PREDICATE)} ${sparqlEscapeUri(LPDC_STATUS_END_URI)}.
          }
        }
      }
    `);

        return result.results.bindings.map(binding => binding.instance.value);
    };

    /**
     * Find all instances that are not flagged or flagged false but have active feedbacks.
     */
    static findUnflaggedInstancesWithStatus = async function () {
        const result = await query(`
      PREFIX schema2: <https://schema.org/>
      PREFIX lpdcExt: <https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#>

      SELECT ?instance WHERE {
        ?feedback a schema2:Conversation.
        ?feedback ${sparqlEscapeUri(IPDC_STATUS_PREDICATE)} ${sparqlEscapeUri(IPDC_STATUS_START_URI)}.
        ?feedback ${sparqlEscapeUri(INSTANCE_PREDICATE)} ?instance.
        ?instance a ${sparqlEscapeUri(INSTANCE_TYPE)}.
        FILTER NOT EXISTS {
          ?feedback ${sparqlEscapeUri(LPDC_STATUS_PREDICATE)} ${sparqlEscapeUri(LPDC_STATUS_END_URI)}.
        }
        OPTIONAL { ?instance lpdcExt:feedbackAvailable ?flagged . }
        FILTER(!BOUND(?flagged) || ?flagged = ${sparqlEscapeBool(false)})
      }
    `);

        return result.results.bindings.map(binding => binding.instance.value);
    };

    /**
     * Check if an instance has any active feedbacks.
     * An active feedback has IPDC_STATUS_START_URI but does NOT have LPDC_STATUS_END_URI.
     * Returns true if there are active feedbacks, false otherwise.
     */
    static hasActiveFeedbacks = async function (instanceUri) {
        if (!instanceUri)
            throw new Error('instanceUri cannot be null.');

        const result = await query(`
      PREFIX schema2: <https://schema.org/>

      ASK {
        ?feedback a schema2:Conversation.
        ?feedback ${sparqlEscapeUri(INSTANCE_PREDICATE)} ${sparqlEscapeUri(instanceUri)}.
        ?feedback ${sparqlEscapeUri(IPDC_STATUS_PREDICATE)} ${sparqlEscapeUri(IPDC_STATUS_START_URI)}.
        FILTER NOT EXISTS {
          ?feedback ${sparqlEscapeUri(LPDC_STATUS_PREDICATE)} ${sparqlEscapeUri(LPDC_STATUS_END_URI)}.
        }
      }
    `);

        return result.boolean;
    };

    /**
     * Find all feedbacks that have any ipdc-status but are missing lpdc-status.
     * These feedbacks should have their lpdc-status set to OPEN.
     */
    static findFeedbacksMissingLpdcStatus = async function () {
        const result = await query(`
      PREFIX schema2: <https://schema.org/>

      SELECT ?feedback WHERE {
        GRAPH ?g {
            ?feedback a schema2:Conversation.
            ?feedback ${sparqlEscapeUri(IPDC_STATUS_PREDICATE)} ?ipdcStatus.
        }

        FILTER(?g != ${sparqlEscapeUri(LDES_GRAPH)})

        FILTER NOT EXISTS {
          GRAPH ?g{
            ?feedback ${sparqlEscapeUri(LPDC_STATUS_PREDICATE)} ?processingStatus.
          }
        }
      }
    `);

        return result.results.bindings.map(binding => binding.feedback.value);
    };
}

export default InstanceRepository;