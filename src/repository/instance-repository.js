import { sparqlEscapeUri, sparqlEscapeBool } from 'mu';
import { querySudo as query, updateSudo as update } from '@lblod/mu-auth-sudo';
import {
  INSTANCE_TYPE,
  INSTANCE_PREDICATE,
  PROCESSING_STATUS_START_URI,
  PROCESSING_STATUS_END_URI,
  PROCESSING_STATUS_PREDICATE,
  STATUS_PREDICATE,
  STATUS_END_URI, STATUS_START_URI
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
    if (!instanceUri)
      throw 'instanceUri can not be null.';

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
   * Set the processing-status of given feedbackUri to starting.
   *
   */
  static setProcessingStatus = async function(feedbackUri) {
    if (!feedbackUri)
      throw 'feedbackUri can not be null.';

    await update(`
      DELETE {
        GRAPH ?g {
            ${sparqlEscapeUri(feedbackUri)} ${sparqlEscapeUri(PROCESSING_STATUS_PREDICATE)} ?oldValue .
        }
      }
      INSERT {
        GRAPH ?g {
            ${sparqlEscapeUri(feedbackUri)} ${sparqlEscapeUri(PROCESSING_STATUS_PREDICATE)} ${sparqlEscapeUri(PROCESSING_STATUS_START_URI)}  .
        }
      }
      WHERE {
        GRAPH ?g {
        ${sparqlEscapeUri(feedbackUri)} a ${sparqlEscapeUri("https://schema.org/Conversation")}.
        OPTIONAL { ${sparqlEscapeUri(feedbackUri)} ${sparqlEscapeUri(PROCESSING_STATUS_PREDICATE)} ?oldValue . }
        }
      }
    `);
  };

  /**
   * Set the status of given feedbackUri to the final stage.
   *
   */
  static finishFeedback = async function(feedbackUri) {
    if (!feedbackUri)
      throw 'feedbackUri can not be null.';

    await update(`
      DELETE {
        GRAPH ?g {
            ${sparqlEscapeUri(feedbackUri)} ${sparqlEscapeUri(STATUS_PREDICATE)} ?oldValue .
        }
      }
      INSERT {
        GRAPH ?g {
            ${sparqlEscapeUri(feedbackUri)} ${sparqlEscapeUri(STATUS_PREDICATE)} ${sparqlEscapeUri(STATUS_END_URI)}  .
        }
      }
      WHERE {
        GRAPH ?g {
        ${sparqlEscapeUri(feedbackUri)} a ${sparqlEscapeUri("https://schema.org/Conversation")}.
        OPTIONAL { ${sparqlEscapeUri(feedbackUri)} ${sparqlEscapeUri(STATUS_PREDICATE)} ?oldValue . }
        }
      }
    `);
  };

  /**
   * Find all instances that are flagged true but don't have the expected status.
   * This includes instances with no feedback link at all, or instances whose
   * feedback doesn't have the expected status.
   */
  static findIncorrectlyFlaggedInstances = async function() {
    if (!STATUS_PREDICATE || !STATUS_START_URI)
      throw 'STATUS_PREDICATE and STATUS_START_URI cannot be null.';

    const result = await query(`
      PREFIX schema2: <https://schema.org/>
      PREFIX lpdcExt: <https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#>

      SELECT DISTINCT ?instance WHERE {
        ?instance lpdcExt:feedbackAvailable ${sparqlEscapeBool(true)}.
        FILTER NOT EXISTS {
          ?feedback a schema2:Conversation.
          ?feedback ${sparqlEscapeUri(INSTANCE_PREDICATE)} ?instance.
          ?feedback ${sparqlEscapeUri(STATUS_PREDICATE)} ${sparqlEscapeUri(STATUS_START_URI)}.
        }
      }
    `);

    return result.results.bindings.map(binding => binding.instance.value);
  };

  /**
   * Find all instances that are not flagged or flagged false but have the expected status.
   *
   */
  static findUnflaggedInstancesWithStatus = async function() {
    if (!STATUS_PREDICATE || !STATUS_START_URI)
      throw 'statusPredicate and statusUri cannot be null.';

    const result = await query(`
      PREFIX schema2: <https://schema.org/>
      PREFIX lpdcExt: <https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#>

      SELECT ?instance WHERE {
        ?feedback a schema2:Conversation.
        ?feedback ${sparqlEscapeUri(STATUS_PREDICATE)} ${sparqlEscapeUri(STATUS_START_URI)}.
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
    if (!instanceUri || !STATUS_PREDICATE || !STATUS_START_URI)
      throw 'instanceUri, STATUS_PREDICATE and STATUS_START_URI cannot be null.';

    const result = await query(`
      PREFIX schema2: <https://schema.org/>

      ASK {
        ?feedback a schema2:Conversation.
        ?feedback ${sparqlEscapeUri(INSTANCE_PREDICATE)} ${sparqlEscapeUri(instanceUri)}.
        ?feedback ${sparqlEscapeUri(STATUS_PREDICATE)} ${sparqlEscapeUri(STATUS_START_URI)}.
      }
    `);

    return result.boolean;
  };

  /**
   * Find all feedbacks that have status AANGEMAAKT but are missing processing-status.
   * These feedbacks should have their processing-status set to START.
   */
  static findFeedbacksMissingProcessingStatus = async function() {
    if (!STATUS_PREDICATE || !STATUS_START_URI || !PROCESSING_STATUS_PREDICATE)
      throw 'STATUS_PREDICATE, STATUS_START_URI, and PROCESSING_STATUS_PREDICATE cannot be null.';

    const result = await query(`
      PREFIX schema2: <https://schema.org/>

      SELECT ?feedback WHERE {
        ?feedback a schema2:Conversation.
        ?feedback ${sparqlEscapeUri(STATUS_PREDICATE)} ${sparqlEscapeUri(STATUS_START_URI)}.
        FILTER NOT EXISTS {
          ?feedback ${sparqlEscapeUri(PROCESSING_STATUS_PREDICATE)} ?processingStatus.
        }
      }
    `);

    return result.results.bindings.map(binding => binding.feedback.value);
  };

  /**
   * Find all feedbacks that have processing-status END and status still in START (AANGEMAAKT).
   * These feedbacks should have their status set to BEANTWOORD.
   */
  static findMissedFeedbacksWithEndProcessingStatus = async function() {
    if (!STATUS_PREDICATE || !STATUS_START_URI || !STATUS_END_URI || !PROCESSING_STATUS_PREDICATE || !PROCESSING_STATUS_END_URI)
      throw 'STATUS_PREDICATE, STATUS_START_URI, STATUS_END_URI, PROCESSING_STATUS_PREDICATE, and PROCESSING_STATUS_END_URI cannot be null.';

    const result = await query(`
      PREFIX schema2: <https://schema.org/>

      SELECT ?feedback WHERE {
        ?feedback a schema2:Conversation.
        ?feedback ${sparqlEscapeUri(PROCESSING_STATUS_PREDICATE)} ${sparqlEscapeUri(PROCESSING_STATUS_END_URI)}.
        ?feedback ${sparqlEscapeUri(STATUS_PREDICATE)} ${sparqlEscapeUri(STATUS_START_URI)}.
      }
    `);

    return result.results.bindings.map(binding => binding.feedback.value);
  };
}

export default InstanceRepository;