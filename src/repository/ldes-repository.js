import {sparqlEscapeUri, sparqlEscapeString, uuid} from 'mu';
import {querySudo as query, updateSudo as update} from '@lblod/mu-auth-sudo';
import {transformIpdcToLpdcUri} from "../utils/uri-utils";
import {
    DEBUG,
    IPDC_STATUS_PREDICATE,
    IPDC_STATUS_START_URI,
    LDES_GRAPH,
    UNKNOWN_GRAPH
} from "../../env";

class LdesRepository {

    /**
     * Get all snapshots from the LDES graph that have not been processed.
     * A snapshot is considered unprocessed if the same URI does not exist outside the LDES graph
     * with the same prov:generatedAtTime.
     */
    static findToProcessSnapshots = async function () {
        const result = await query(/* sparql */`
            PREFIX schema: <https://schema.org/>
            PREFIX prov:   <http://www.w3.org/ns/prov#>

            SELECT ?snapshotUri WHERE {
                GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                     ?snapshotUri a schema:Conversation .
                     ?snapshotUri prov:generatedAtTime ?generatedAtTime .
                }
                FILTER NOT EXISTS {
                    GRAPH ?g {
                        ?snapshotUri prov:generatedAtTime ?generatedAtTime2 .
                    }
                    FILTER(
                        ?g != ${sparqlEscapeUri(LDES_GRAPH)} &&
                        (?generatedAtTime2 = ?generatedAtTime || ?generatedAtTime2 > ?generatedAtTime)
                    )
                }
            } ORDER BY ?generatedAtTime
        `);

        return result.results.bindings.map(binding => binding.snapshotUri.value);
    }

    /**
     * Extract sender and recipient organization URIs from a feedback snapshot.
     * The sender is identified via schema:agent and the recipient via schema:recipient
     * on the question associated with the snapshot conversation.
     */
    static extractOrganizationUris = async function (snapshotUri) {
        if (!snapshotUri)
            throw new Error('snapshotUri cannot be null.');

        const result = await query(`
            PREFIX schema: <https://schema.org/>

            SELECT DISTINCT ?senderUri ?recipientUri WHERE {
                GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                    ${sparqlEscapeUri(snapshotUri)} a schema:Conversation .

                    ${sparqlEscapeUri(snapshotUri)} schema:question ?question .

                     ?question schema:agent ?senderUri .
                     ?question schema:recipient ?recipientUri .
                }
            }
        `);

        if (result.results.bindings.length === 0) {
            throw new Error(`No organization URIs found in snapshot ${snapshotUri}`);
        }

        const binding = result.results.bindings[0];

        if (!binding.recipientUri) {
            throw new Error(`No recipient URI found in snapshot ${snapshotUri} - cannot determine organization graph`);
        }

        return {
            sender: binding.senderUri?.value,
            recipient: binding.recipientUri.value
        };
    };

    /**
     * Check if feedback already exists in LPDC data and return the organization graph URI.
     * Returns null if the feedback does not exist in any organization graph.
     */
    static getOrgGraphForExistingFeedback = async function (feedbackUri) {
        if (!feedbackUri)
            throw new Error('feedbackUri cannot be null.');

        const result = await query(`
            PREFIX schema: <https://schema.org/>

            SELECT ?g WHERE {
                GRAPH ?g {
                    ${sparqlEscapeUri(feedbackUri)} a schema:Conversation .
                }
                FILTER STRSTARTS(str(?g), "http://mu.semte.ch/graphs/organizations/")
                FILTER STRENDS(str(?g), "/LoketLB-LPDCGebruiker")
            }
        `);

        if (result.results.bindings.length > 0) {
            return result.results.bindings[0].g.value;
        } else {
            return null;
        }
    };

    /**
     * Checks if the current or a newer version of the given feedback uri is already processed
     */
    static feedbackVersionIsAlreadyProcessed = async function (feedbackUri) {
        if (!feedbackUri)
            throw new Error('feedbackUri cannot be null.');
        const result = await query(/* sparql */`
            PREFIX schema: <https://schema.org/>

            SELECT ?laterGeneratedAtTime  
            WHERE {
                GRAPH ?g {
                    ${sparqlEscapeUri(feedbackUri)} prov:generatedAtTime ?laterGeneratedAtTime.
                }
                GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                    ${sparqlEscapeUri(feedbackUri)} prov:generatedAtTime ?generatedAtTime.
                }
                FILTER(?laterGeneratedAtTime >= ?generatedAtTime)
                FILTER(?g != ${sparqlEscapeUri(LDES_GRAPH)})
            }
        `);
        return result.results.bindings.length > 0;
    }


    /**
     * Copy feedback data from LDES graph to organization graph.
     * This recursively copies all triples where feedbackUri is the subject.
     */
    static copyFeedbackToOrganizationGraph = async function (feedbackUri, bestuurseenheidUri, targetGraph, transformedInstanceUri) {
        if (!feedbackUri)
            throw new Error('feedbackUri cannot be null.');
        if (!bestuurseenheidUri)
            throw new Error('bestuurseenheidUri cannot be null.');
        if (!targetGraph)
            throw new Error('targetGraph cannot be null.');
        if (!transformedInstanceUri)
            throw new Error('transformedInstanceUri cannot be null.');

        const feedbackUuid = uuid();
        const answerUuid = uuid();
        const questionUuid = uuid();

        const questionUri = `https://ipdc.vlaanderen.be/publicatie/id/question/${questionUuid}`;
        const answerUri = `https://ipdc.vlaanderen.be/publicatie/id/answer/${answerUuid}`;

        await update(`
          PREFIX schema: <https://schema.org/>
          PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
          PREFIX lpdcExt: <https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#>
          PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

          INSERT {
          GRAPH ${sparqlEscapeUri(targetGraph)} {
              ${sparqlEscapeUri(feedbackUri)} ?p ?oReplaced .

              ${sparqlEscapeUri(feedbackUri)} skos:primarySubject ${sparqlEscapeUri(transformedInstanceUri)} .
              ${sparqlEscapeUri(feedbackUri)} lpdcExt:receiverBestuurseenheid ${sparqlEscapeUri(bestuurseenheidUri)} .
              ${sparqlEscapeUri(feedbackUri)} mu:uuid ${sparqlEscapeString(feedbackUuid)} .

              ${sparqlEscapeUri(questionUri)} ?questionPred ?questionObj .
              ${sparqlEscapeUri(questionUri)} mu:uuid ${sparqlEscapeString(questionUuid)} .

              ${sparqlEscapeUri(answerUri)} ?answerPred ?answerObj .
              ${sparqlEscapeUri(answerUri)} mu:uuid ${sparqlEscapeString(answerUuid)} .
          }
          }
          WHERE {
              {
                  GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                      ${sparqlEscapeUri(feedbackUri)} ?p ?o .

                      BIND(IF(?p = schema:question, ${sparqlEscapeUri(questionUri)},
                           IF(?p = schema:suggestedAnswer, ${sparqlEscapeUri(answerUri)},
                           ?o)) AS ?oReplaced)
                  }
              }
              OPTIONAL {
                  GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                      ${sparqlEscapeUri(feedbackUri)} schema:question ?questionBlank .
                      ?questionBlank ?questionPred ?questionObj .
                  }
              }
              OPTIONAL {
                  GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                      ${sparqlEscapeUri(feedbackUri)} schema:suggestedAnswer ?answerBlank .
                      ?answerBlank ?answerPred ?answerObj .
                  }
              }
          }
      `);

        if (DEBUG) {
            console.log(`  ✓ Copied feedback data for ${feedbackUri}`);
        }
    };


    /**
     * Add feedback to the unknown graph.
     * Used when the recipient organization cannot be determined or matched.
     * Deletes any existing error data for the feedback before inserting.
     */
    static addFeedbackToUnknownGraph = async function (feedbackUri) {
        if (!feedbackUri)
            throw new Error('feedbackUri cannot be null.');

        await update(`
          PREFIX schema: <https://schema.org/>
          PREFIX prov: <http://www.w3.org/ns/prov#>

          DELETE {
              GRAPH ${sparqlEscapeUri(UNKNOWN_GRAPH)} {
                  ${sparqlEscapeUri(feedbackUri)} ?p ?o .
              }
          }
          INSERT {
              GRAPH ${sparqlEscapeUri(UNKNOWN_GRAPH)} {
                  ${sparqlEscapeUri(feedbackUri)} a schema:Conversation .
                  ${sparqlEscapeUri(feedbackUri)} prov:generatedAtTime ?generatedAtTime .
              }
          }
          WHERE {
              {
                  GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                      ${sparqlEscapeUri(feedbackUri)} a schema:Conversation .
                      ${sparqlEscapeUri(feedbackUri)} prov:generatedAtTime ?generatedAtTime .
                  }
              }
              OPTIONAL {
                  GRAPH ${sparqlEscapeUri(UNKNOWN_GRAPH)} {
                      ${sparqlEscapeUri(feedbackUri)} ?p ?o .
                  }
              }
          }
      `);

        if (DEBUG) {
            console.log(`  ✓ Added/updated ${feedbackUri} in unknown graph`);
        }
    };

    /**
     * Remove feedback from the unknown graph.
     */
    static removeFeedbackFromUnknownGraph = async function (feedbackUri) {
        if (!feedbackUri)
            throw new Error('feedbackUri cannot be null.');

        await update(`
          DELETE {
              GRAPH ${sparqlEscapeUri(UNKNOWN_GRAPH)} {
                  ${sparqlEscapeUri(feedbackUri)} ?p ?o .
              }
          }
          WHERE {
              GRAPH ${sparqlEscapeUri(UNKNOWN_GRAPH)} {
                  ${sparqlEscapeUri(feedbackUri)} ?p ?o .
              }
          }
      `);
    };


    /**
     * Update existing feedback data in organization graph.
     * This deletes the old feedback data and copies the new version from LDES graph.
     * Enriched data is ignored and stays the same.
     */
    static updateFeedbackInOrganizationGraph = async function (feedbackUri, targetGraph) {
        if (!feedbackUri)
            throw new Error('feedbackUri cannot be null.');
        if (!targetGraph)
            throw new Error('targetGraph cannot be null.');

        await update(`
            PREFIX schema: <https://schema.org/>

            DELETE {
                GRAPH ${sparqlEscapeUri(targetGraph)} {
                    ${sparqlEscapeUri(feedbackUri)} ?pNew ?oOld .
                }
            }
            INSERT {
                GRAPH ${sparqlEscapeUri(targetGraph)} {
                    ${sparqlEscapeUri(feedbackUri)} ?pNew ?oNew .
                }
            }
            WHERE {
                {
                    GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                        ${sparqlEscapeUri(feedbackUri)} ?pNew ?oNew .
                        FILTER (?pNew NOT IN (schema:suggestedAnswer, schema:question))
                    }
                }
                OPTIONAL {
                    GRAPH ${sparqlEscapeUri(targetGraph)} {
                        ${sparqlEscapeUri(feedbackUri)} ?pNew ?oOld .
                    }
                }
            }
        `);

        if (DEBUG) {
            console.log(`  ✓ Updated feedback data for ${feedbackUri} in graph ${targetGraph}`);
        }
    };

    /**
     * Get the transformed LPDC instance URI associated with a feedback.
     * Transforms the IPDC instance URI to LPDC format and verifies the instance exists.
     * Returns null if the instance does not exist in LPDC.
     */
    static async getTransformedInstanceUri(feedbackUri) {
        if (!feedbackUri)
            throw new Error('feedbackUri cannot be null.');

        const instanceUriResult = await query(`
          PREFIX schema: <https://schema.org/>
          
          SELECT ?instanceUri
          WHERE {
              GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                  ${sparqlEscapeUri(feedbackUri)} schema:about ?instanceUri .
              }
          }
      `);

        const instanceUri = instanceUriResult.results.bindings[0]?.instanceUri?.value;
        if (!instanceUri) {
            throw new Error('feedback has no instance linked to it.');
        }

        const transformedUri = transformIpdcToLpdcUri(instanceUri);
        const checkInstanceExist = await query(`
          PREFIX lpdcExt: <https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#>
          ASK{
               ${sparqlEscapeUri(transformedUri)} a lpdcExt:InstancePublicService.
          }
      `);

        if (checkInstanceExist.boolean) {
            return transformedUri;
        } else {
            return null;
        }

    }

    /**
     * Check if feedback has IPDC start status.
     * Returns true if the feedback is in the initial IPDC status state.
     */
    static async isFeedbackInIpdcStartStatus(feedbackUri) {
        if (!feedbackUri)
            throw new Error('feedbackUri cannot be null.');

        const result = await query(`
          PREFIX schema: <https://schema.org/>
          ASK{
               ${sparqlEscapeUri(feedbackUri)} a schema:Conversation.
               ${sparqlEscapeUri(feedbackUri)}  ${sparqlEscapeUri(IPDC_STATUS_PREDICATE)}  ${sparqlEscapeUri(IPDC_STATUS_START_URI)}.
          }
      `);

        return result.boolean;
    }
}

export default LdesRepository;