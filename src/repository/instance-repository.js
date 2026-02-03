import { sparqlEscapeUri, sparqlEscapeBool } from 'mu';
import { querySudo as query, updateSudo as update } from '@lblod/mu-auth-sudo';
import {INSTANCE_TYPE, INSTANCE_PREDICATE} from '../../env';


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
      PREFIX schema: <http://schema.org/>

      DELETE {
        GRAPH ?g {
            ${sparqlEscapeUri(instanceUri)} schema:flagged ?oldValue .
        }
      }
      INSERT {
        GRAPH ?g {
            ${sparqlEscapeUri(instanceUri)} schema:flagged ${sparqlEscapeBool(flagged)} .
        }
      }
      WHERE {
        GRAPH ?g {
        ${sparqlEscapeUri(instanceUri)} a ${sparqlEscapeUri(INSTANCE_TYPE)}.
        OPTIONAL { ${sparqlEscapeUri(instanceUri)} schema:flagged ?oldValue . }
        }
      }
    `);
  };

  /**
   * Find all instances that are flagged true but don't have the expected status.
   * This includes instances with no feedback link at all, or instances whose
   * feedback doesn't have the expected status.
   */
  static findIncorrectlyFlaggedInstances = async function(statusPredicate, statusUri) {
    if (!statusPredicate || !statusUri)
      throw 'statusPredicate and statusUri cannot be null.';

    const result = await query(`
      PREFIX schema: <http://schema.org/>
      PREFIX schema2: <https://schema.org/>

      SELECT DISTINCT ?instance WHERE {
        ?instance schema:flagged ${sparqlEscapeBool(true)}.
        FILTER NOT EXISTS {
          ?feedback a schema2:Conversation.
          ?feedback ${sparqlEscapeUri(INSTANCE_PREDICATE)} ?instance.
          ?feedback ${sparqlEscapeUri(statusPredicate)} ${sparqlEscapeUri(statusUri)}.
        }
      }
    `);

    return result.results.bindings.map(binding => binding.instance.value);
  };

  /**
   * Find all instances that are not flagged or flagged false but have the expected status.
   *
   */
  static findUnflaggedInstancesWithStatus = async function(statusPredicate, statusUri) {
    if (!statusPredicate || !statusUri)
      throw 'statusPredicate and statusUri cannot be null.';

    const result = await query(`
      PREFIX schema: <http://schema.org/>
      PREFIX schema2: <https://schema.org/>

      SELECT ?instance WHERE {
        ?feedback a schema2:Conversation.
        ?feedback ${sparqlEscapeUri(statusPredicate)} ${sparqlEscapeUri(statusUri)}.
        ?feedback ${sparqlEscapeUri(INSTANCE_PREDICATE)} ?instance.
        OPTIONAL { ?instance schema:flagged ?flagged . }
        FILTER(!BOUND(?flagged) || ?flagged = ${sparqlEscapeBool(false)})
      }
    `);

    return result.results.bindings.map(binding => binding.instance.value);
  };
}

export default InstanceRepository;