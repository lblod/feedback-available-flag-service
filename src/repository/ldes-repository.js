import {sparqlEscapeUri, sparqlEscapeString, uuid} from 'mu';
import {querySudo as query, updateSudo as update} from '@lblod/mu-auth-sudo';
import {extractFinalPartUri, transformIpdcToLpdcUri} from "../utils/uri-utils";
import {DEBUG, LDES_GRAPH, UNKNOWN_GRAPH} from "../../env";

class LdesRepository {

    /**
     * Get all snapshots from the ldes graph that have not been processed.
     * To check if a snapshot has been processed, we look at if the same uri exists outside the ldes graph
     * with the same prov:generatedAtTime
     */
    static findToProcessSnapshots = async function () {
        const result = await query(`
            PREFIX schema: <https://schema.org/>
            PREFIX prov:   <https://www.w3.org/ns/prov#>

            SELECT ?snapshotUri WHERE {
                GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                     ?snapshotUri a schema:Conversation .
                     ?snapshotUri prov:generatedAtTime ?generatedAtTime .

                     BIND(IF(isLiteral(?generatedAtTime) && STRSTARTS(str(datatype(?generatedAtTime)), "https://www.w3.org/"),
                             STRDT(str(?generatedAtTime), IRI(REPLACE(str(datatype(?generatedAtTime)), "^https://", "http://"))),
                             ?generatedAtTime) AS ?generatedAtTimeConverted)
                }
                FILTER NOT EXISTS {
                GRAPH ?g {
                        ?snapshotUri prov:generatedAtTime ?generatedAtTime2 .
                    }
                FILTER(
                    ?g != ${sparqlEscapeUri(LDES_GRAPH)} &&
                    ?generatedAtTime2 = ?generatedAtTimeConverted)
                }
            } ORDER BY ?generatedAtTime
        `);

        return result.results.bindings.map(binding => binding.snapshotUri.value);
    }

    /**
     * Extract sender and recipient organization URIs from a snapshot.
     * - sender (from): schema:agent
     * - recipient (to): schema:recipient
     */
    static extractOrganizationUris = async function (snapshotUri) {
        if (!snapshotUri)
            throw new Error('snapshotUri cannot be null.');

        const result = await query(`
            PREFIX schema: <https://schema.org/>
            PREFIX dct: <http://purl.org/dc/terms/>

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
     * Check if the given feedbackUri is already in lpdc data
     */
    static checkIfFeedbackInLpdcData = async function (feedbackUri) {
        if (!feedbackUri)
            throw new Error('feedbackUri cannot be null.');

        const result = await query(`
            PREFIX schema: <https://schema.org/>

            SELECT ?g WHERE {
                GRAPH ?g {
                    ${sparqlEscapeUri(feedbackUri)} a schema:Conversation .
                }
                FILTER (?g != ${sparqlEscapeUri(LDES_GRAPH)} && ?g != ${sparqlEscapeUri(UNKNOWN_GRAPH)})
            }
        `);

        if (result.results.bindings.length > 0) {
            return result.results.bindings[0].g.value;
        } else {
            return null;
        }
    };


    /**
     * Copy feedback data from LDES graph to organization graph.
     * This recursively copies all triples where feedbackUri is the subject,
     * including nested blank nodes.
     */
    static copyFeedbackToOrganizationGraph = async function (feedbackUri, bestuurseenheidUri, targetGraph) {
        if (!feedbackUri)
            throw new Error('feedbackUri cannot be null.');
        if (!bestuurseenheidUri)
            throw new Error('bestuurseenheidUri cannot be null.');
        if (!targetGraph)
            throw new Error('targetGraph cannot be null.');

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
        let transformedUri;
        if (instanceUri) {
            transformedUri = transformIpdcToLpdcUri(instanceUri);
        } else {
            throw new Error('feedback has no instance linked to it.');
        }

        const feedbackUuid = extractFinalPartUri(feedbackUri);
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
              ${sparqlEscapeUri(feedbackUri)} ?p ?oReplacedFinal .

              ${sparqlEscapeUri(feedbackUri)} skos:primarySubject ${sparqlEscapeUri(transformedUri)} .
              ${sparqlEscapeUri(feedbackUri)} lpdcExt:receiverBestuurseenheid ${sparqlEscapeUri(bestuurseenheidUri)} .
              ${sparqlEscapeUri(feedbackUri)} mu:uuid ${sparqlEscapeString(feedbackUuid)} .

              ${sparqlEscapeUri(questionUri)} ?questionPred ?questionObjFixed .
              ${sparqlEscapeUri(questionUri)} mu:uuid ${sparqlEscapeString(questionUuid)} .

              ${sparqlEscapeUri(answerUri)} ?answerPred ?answerObjFixed .
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

                      BIND(IF(isLiteral(?oReplaced) && STRSTARTS(str(datatype(?oReplaced)), "https://www.w3.org/"),
                              STRDT(str(?oReplaced), IRI(REPLACE(str(datatype(?oReplaced)), "^https://", "http://"))),
                              ?oReplaced) AS ?oReplacedFinal)
                  }
              }
              OPTIONAL {
                  GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                      ${sparqlEscapeUri(feedbackUri)} schema:question ?questionBlank .
                      ?questionBlank ?questionPred ?questionObj .

                      BIND(IF(isLiteral(?questionObj) && STRSTARTS(str(datatype(?questionObj)), "https://www.w3.org/"),
                              STRDT(str(?questionObj), IRI(REPLACE(str(datatype(?questionObj)), "^https://", "http://"))),
                              ?questionObj) AS ?questionObjFixed)
                  }
              }
              OPTIONAL {
                  GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                      ${sparqlEscapeUri(feedbackUri)} schema:suggestedAnswer ?answerBlank .
                      ?answerBlank ?answerPred ?answerObj .

                      BIND(IF(isLiteral(?answerObj) && STRSTARTS(str(datatype(?answerObj)), "https://www.w3.org/"),
                              STRDT(str(?answerObj), IRI(REPLACE(str(datatype(?answerObj)), "^https://", "http://"))),
                              ?answerObj) AS ?answerObjFixed)
                  }
              }
          }
      `);

        if (DEBUG) {
            console.log(`  ✓ Copied feedback data for ${feedbackUri}`);
        }
    };


    /**
     * Add feedbackUri to the unknown receiver graph.
     */
    static addFeedbackToUnknownGraph = async function (feedbackUri) {
        if (!feedbackUri)
            throw new Error('feedbackUri cannot be null.');

        await update(`
          PREFIX schema: <https://schema.org/>
          PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
          PREFIX lpdcExt: <https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#>
          PREFIX prov: <https://www.w3.org/ns/prov#>

          DELETE {
              GRAPH ${sparqlEscapeUri(UNKNOWN_GRAPH)} {
                  ${sparqlEscapeUri(feedbackUri)} ?p ?o .
              }
          }
          INSERT {
              GRAPH ${sparqlEscapeUri(UNKNOWN_GRAPH)} {
                  ${sparqlEscapeUri(feedbackUri)} a schema:Conversation .
                  ${sparqlEscapeUri(feedbackUri)} prov:generatedAtTime ?generatedAtTimeConverted .
              }
          }
          WHERE {
              {
                  GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                      ${sparqlEscapeUri(feedbackUri)} a schema:Conversation .
                      ${sparqlEscapeUri(feedbackUri)} prov:generatedAtTime ?generatedAtTime .

                      BIND(IF(isLiteral(?generatedAtTime) && STRSTARTS(str(datatype(?generatedAtTime)), "https://www.w3.org/"),
                              STRDT(str(?generatedAtTime), IRI(REPLACE(str(datatype(?generatedAtTime)), "^https://", "http://"))),
                              ?generatedAtTime) AS ?generatedAtTimeConverted)
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
     * Remove feedbackUri from the unknown receiver graph.
     */
    static removeFeedbackFromUnknownGraph = async function (feedbackUri) {
        if (!feedbackUri)
            throw new Error('feedbackUri cannot be null.');

        await update(`
          PREFIX schema: <https://schema.org/>

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
            PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
            PREFIX lpdcExt: <https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#>
            PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

            DELETE {
                GRAPH ${sparqlEscapeUri(targetGraph)} {
                    ${sparqlEscapeUri(feedbackUri)} ?p ?o .
                }
            }
            INSERT {
                GRAPH ${sparqlEscapeUri(targetGraph)} {
                    ${sparqlEscapeUri(feedbackUri)} ?pNew ?oNewFixed .
                }
            }
            WHERE {
                {
                    GRAPH ${sparqlEscapeUri(targetGraph)} {
                        ${sparqlEscapeUri(feedbackUri)} ?p ?o .
                        FILTER (?p NOT IN (schema:actionStatus, schema:result, skos:primarySubject, lpdcExt:receiverBestuurseenheid, mu:uuid, schema:suggestedAnswer, schema:question))
                    }
                }
                {
                    GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                        ${sparqlEscapeUri(feedbackUri)} ?pNew ?oNew .

                        BIND(IF(isLiteral(?oNew) && STRSTARTS(str(datatype(?oNew)), "https://www.w3.org/"),
                                STRDT(str(?oNew), IRI(REPLACE(str(datatype(?oNew)), "^https://", "http://"))),
                                ?oNew) AS ?oNewFixed)
                    }
                }
            }
        `);

        if (DEBUG) {
            console.log(`  ✓ Updated feedback data for ${feedbackUri} in graph ${targetGraph}`);
        }
    };
}

export default LdesRepository;