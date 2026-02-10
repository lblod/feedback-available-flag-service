import { sparqlEscapeUri, sparqlEscapeBool } from 'mu';
import { querySudo as query, updateSudo as update } from '@lblod/mu-auth-sudo';
import {
  INSTANCE_TYPE,
  INSTANCE_PREDICATE,
  LPDC_STATUS_START_URI,
  LPDC_STATUS_END_URI,
  LPDC_STATUS_PREDICATE,
  IPDC_STATUS_PREDICATE,
  IPDC_STATUS_END_URI, IPDC_STATUS_START_URI
} from '../../env';


class InstanceRepository {

  /**
   * Find instance to flag that is linked to this feedback uri.
   *
   */
  static findInstanceByURI = async function(uri) {
    if (!uri)
      throw 'uri can not be null.';
    const result = await query(`
      PREFIX schema2: <https://schema.org/>
      
      SELECT ?instance WHERE {
        VALUES ?uri { ${sparqlEscapeUri(uri)} }
        ?uri a schema2:Conversation.
        ?uri ${sparqlEscapeUri(INSTANCE_PREDICATE)} ?instance
      }
    `);
    if (result.results.bindings.length === 0)
      throw `URI <${uri}> is not linked to an instance, data corrupt?`;
    if (result.results.bindings.length > 1)
      throw `multiple results exists while doing lookup on URI <${uri}>, data corrupt?`;
    return result.results.bindings[0].instance.value;
  };

  /**
   * Updates the flagged property on an instance with given uri.
   *
   */
  static updateInstanceFlagged = async function(instanceUri, flagged) {
    if (!instanceUri || !INSTANCE_TYPE)
      throw 'instanceUri AND INSTANCE_TYPE can not be null.';

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
   * Set the ldpc-status of given feedbackUri to starting.
   *
   */
  static setLpdcStatus = async function(feedbackUri) {
    if (!feedbackUri)
      throw 'feedbackUri can not be null.';

    await update(`
      DELETE {
        GRAPH ?g {
            ${sparqlEscapeUri(feedbackUri)} ${sparqlEscapeUri(LPDC_STATUS_PREDICATE)} ?oldValue .
        }
      }
      INSERT {
        GRAPH ?g {
            ${sparqlEscapeUri(feedbackUri)} ${sparqlEscapeUri(LPDC_STATUS_PREDICATE)} ${sparqlEscapeUri(LPDC_STATUS_START_URI)}  .
        }
      }
      WHERE {
        GRAPH ?g {
        ${sparqlEscapeUri(feedbackUri)} a ${sparqlEscapeUri("https://schema.org/Conversation")}.
        OPTIONAL { ${sparqlEscapeUri(feedbackUri)} ${sparqlEscapeUri(LPDC_STATUS_PREDICATE)} ?oldValue . }
        }
      }
    `);
  };

  /**
   * Set the ipdc-status of given feedbackUri to the final stage.
   *
   */
  static finishFeedback = async function(feedbackUri) {
    if (!feedbackUri || !IPDC_STATUS_PREDICATE || !IPDC_STATUS_END_URI)
      throw 'feedbackUri and IPDC_STATUS_PREDICATE and IPDC_STATUS_END_URI can not be null.';

    await update(`
      DELETE {
        GRAPH ?g {
            ${sparqlEscapeUri(feedbackUri)} ${sparqlEscapeUri(IPDC_STATUS_PREDICATE)} ?oldValue .
        }
      }
      INSERT {
        GRAPH ?g {
            ${sparqlEscapeUri(feedbackUri)} ${sparqlEscapeUri(IPDC_STATUS_PREDICATE)} ${sparqlEscapeUri(IPDC_STATUS_END_URI)}  .
        }
      }
      WHERE {
        GRAPH ?g {
        ${sparqlEscapeUri(feedbackUri)} a ${sparqlEscapeUri("https://schema.org/Conversation")}.
        OPTIONAL { ${sparqlEscapeUri(feedbackUri)} ${sparqlEscapeUri(IPDC_STATUS_PREDICATE)} ?oldValue . }
        }
      }
    `);
  };

  /**
   * Find all instances that are flagged true but don't have the expected ipdc-status.
   * This includes instances with no feedback link at all or instances whose
   * feedback doesn't have the expected ipdc-status.
   */
  static findIncorrectlyFlaggedInstances = async function() {
    if (!IPDC_STATUS_PREDICATE || !IPDC_STATUS_START_URI)
      throw 'IPDC_STATUS_PREDICATE and IPDC_STATUS_START_URI cannot be null.';

    const result = await query(`
      PREFIX schema2: <https://schema.org/>
      PREFIX lpdcExt: <https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#>

      SELECT DISTINCT ?instance WHERE {
        ?instance lpdcExt:feedbackAvailable ${sparqlEscapeBool(true)}.
        FILTER NOT EXISTS {
          ?feedback a schema2:Conversation.
          ?feedback ${sparqlEscapeUri(INSTANCE_PREDICATE)} ?instance.
          ?feedback ${sparqlEscapeUri(IPDC_STATUS_PREDICATE)} ${sparqlEscapeUri(IPDC_STATUS_START_URI)}.
        }
      }
    `);

    return result.results.bindings.map(binding => binding.instance.value);
  };

  /**
   * Find all instances that are not flagged or flagged false but have the expected ipdc-status.
   *
   */
  static findUnflaggedInstancesWithStatus = async function() {
    if (!IPDC_STATUS_PREDICATE || !IPDC_STATUS_START_URI || !INSTANCE_PREDICATE)
      throw 'IPDC_STATUS_PREDICATE and IPDC_STATUS_START_URI and INSTANCE_PREDICATE cannot be null.';

    const result = await query(`
      PREFIX schema2: <https://schema.org/>
      PREFIX lpdcExt: <https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#>

      SELECT ?instance WHERE {
        ?feedback a schema2:Conversation.
        ?feedback ${sparqlEscapeUri(IPDC_STATUS_PREDICATE)} ${sparqlEscapeUri(IPDC_STATUS_START_URI)}.
        ?feedback ${sparqlEscapeUri(INSTANCE_PREDICATE)} ?instance.
        OPTIONAL { ?instance lpdcExt:feedbackAvailable ?flagged . }
        FILTER(!BOUND(?flagged) || ?flagged = ${sparqlEscapeBool(false)})
      }
    `);

    return result.results.bindings.map(binding => binding.instance.value);
  };

  /**
   * Check if an instance has any active feedbacks with the expected status.
   * Returns true if there are active feedbacks, false otherwise.
   */
  static hasActiveFeedbacks = async function(instanceUri) {
    if (!instanceUri || !IPDC_STATUS_PREDICATE || !IPDC_STATUS_START_URI)
      throw 'instanceUri, IPDC_STATUS_PREDICATE and IPDC_STATUS_START_URI cannot be null.';

    const result = await query(`
      PREFIX schema2: <https://schema.org/>

      ASK {
        ?feedback a schema2:Conversation.
        ?feedback ${sparqlEscapeUri(INSTANCE_PREDICATE)} ${sparqlEscapeUri(instanceUri)}.
        ?feedback ${sparqlEscapeUri(IPDC_STATUS_PREDICATE)} ${sparqlEscapeUri(IPDC_STATUS_START_URI)}.
      }
    `);

    return result.boolean;
  };

  /**
   * Find all feedbacks that have ipdc-status AANGEMAAKT but are missing lpdc-status.
   * These feedbacks should have their lpdc-status set to OPEN.
   */
  static findFeedbacksMissingLpdcStatus = async function() {
    if (!IPDC_STATUS_PREDICATE || !IPDC_STATUS_START_URI || !LPDC_STATUS_PREDICATE)
      throw 'IPDC_STATUS_PREDICATE, IPDC_STATUS_START_URI, and LPDC_STATUS_PREDICATE cannot be null.';

    const result = await query(`
      PREFIX schema2: <https://schema.org/>

      SELECT ?feedback WHERE {
        ?feedback a schema2:Conversation.
        ?feedback ${sparqlEscapeUri(IPDC_STATUS_PREDICATE)} ${sparqlEscapeUri(IPDC_STATUS_START_URI)}.
        FILTER NOT EXISTS {
          ?feedback ${sparqlEscapeUri(LPDC_STATUS_PREDICATE)} ?processingStatus.
        }
      }
    `);

    return result.results.bindings.map(binding => binding.feedback.value);
  };

  /**
   * Find all feedbacks that have lpdc-status VEWERKT and ipdc-status still in START (AANGEMAAKT).
   * These feedbacks should have their ipdc-status set to BEANTWOORD.
   */
  static findMissedFeedbacksWithEndLpdcStatus = async function() {
    if (!IPDC_STATUS_PREDICATE || !IPDC_STATUS_START_URI || !IPDC_STATUS_END_URI || !LPDC_STATUS_PREDICATE || !LPDC_STATUS_END_URI)
      throw 'IPDC_STATUS_PREDICATE, IPDC_STATUS_START_URI, IPDC_STATUS_END_URI, LPDC_STATUS_PREDICATE, and LPDC_STATUS_END_URI cannot be null.';

    const result = await query(`
      PREFIX schema2: <https://schema.org/>

      SELECT ?feedback WHERE {
        ?feedback a schema2:Conversation.
        ?feedback ${sparqlEscapeUri(LPDC_STATUS_PREDICATE)} ${sparqlEscapeUri(LPDC_STATUS_END_URI)}.
        ?feedback ${sparqlEscapeUri(IPDC_STATUS_PREDICATE)} ${sparqlEscapeUri(IPDC_STATUS_START_URI)}.
      }
    `);

    return result.results.bindings.map(binding => binding.feedback.value);
  };
}

export default InstanceRepository;