import {sparqlEscapeUri, uuid} from 'mu';
import {querySudo as query, updateSudo as update} from '@lblod/mu-auth-sudo';
import {transformIpdcToLpdcUri} from "../utils/uri-utils";
import {DEBUG, LDES_GRAPH} from "../../env";

class LdesRepository {
    static findToProcessSnapshots = async function () {

        //Change logic to use something in the data itself not in ldes graph (NO MARKERS)

        const result = await query(`
            SELECT ?snapshotUri WHERE {
                GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                     ?snapshotUri a ${sparqlEscapeUri("https://schema.org/DataFeedItem")} .
                     ?snapshotUri <https://schema.org/dateCreated> ?generatedAtTime .
                }
                FILTER NOT EXISTS {
                GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                        ?marker a <https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#VersionedLdesSnapshotProcessedMarker> .
                        ?marker <http://mu.semte.ch/vocabularies/ext/processedSnapshot> ?snapshotUri .
                    }
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
            throw 'snapshotUri cannot be null.';

        const result = await query(`
            PREFIX schema: <https://schema.org/>
            PREFIX dct: <http://purl.org/dc/terms/>

            SELECT DISTINCT ?senderUri ?recipientUri WHERE {
                GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                    ${sparqlEscapeUri(snapshotUri)} schema:item ?feedback .

                    ?feedback schema:question ?question .

                     ?question schema:agent ?senderUri .
                     ?question schema:recipient ?recipientUri .
                }
            }
        `);

        if (result.results.bindings.length === 0) {
            throw `No organization URIs found in snapshot ${snapshotUri}`;
        }

        const binding = result.results.bindings[0];

        if (!binding.recipientUri) {
            throw `No recipient URI found in snapshot ${snapshotUri} - cannot determine organization graph`;
        }

        return {
            sender: binding.senderUri?.value,
            recipient: binding.recipientUri.value
        };
    };


    /**
     * Get the feedback URI from a snapshot using schema:item
     */
    static getFeedbackUri = async function (snapshotUri) {
        if (!snapshotUri)
            throw 'snapshotUri cannot be null.';

        const result = await query(`
            PREFIX schema: <https://schema.org/>

            SELECT ?feedback WHERE {
                GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                    ${sparqlEscapeUri(snapshotUri)} schema:item ?feedback .
                }
            }
        `);

        if (result.results.bindings.length === 0) {
            throw `No feedback URI found for snapshot ${snapshotUri}`;
        }

        return result.results.bindings[0].feedback.value;
    };

    /**
     * Check if the given feedbackUri is already in lpdc data
     */
    static checkIfFeedbackInLpdcData = async function (feedbackUri) {
        if (!feedbackUri)
            throw 'feedbackUri cannot be null.';

        const result = await query(`
            PREFIX schema: <https://schema.org/>

            SELECT ?g WHERE {
                GRAPH ?g {
                    ${sparqlEscapeUri(feedbackUri)} a schema:Conversation .
                }
                FILTER (?g != ${sparqlEscapeUri(LDES_GRAPH)})
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
            throw 'feedbackUri cannot be null.';
        if (!bestuurseenheidUri)
            throw 'bestuurseenheidUri cannot be null.';
        if (!targetGraph)
            throw 'targetGraph cannot be null.';

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
            throw 'feedback has no instance linked to it.';
        }

        await update(`
          PREFIX schema: <https://schema.org/>
          PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
          PREFIX lpdcExt: <https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#>
                    
          INSERT {
          GRAPH ${sparqlEscapeUri(targetGraph)} {
              ${sparqlEscapeUri(feedbackUri)} ?p ?o .
              ?o ?pp ?nested .
              ${sparqlEscapeUri(feedbackUri)} skos:primarySubject ${sparqlEscapeUri(transformedUri)} .
              ${sparqlEscapeUri(feedbackUri)} lpdcExt:receiverBestuurseenheid ${sparqlEscapeUri(bestuurseenheidUri)} .
          }
          }
          WHERE {
              {
                  GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                      ${sparqlEscapeUri(feedbackUri)} ?p ?o .
                      OPTIONAL { ?o ?pp ?nested . }
                  }
              }
          }
      `);

        if (DEBUG) {
            console.log(`  ✓ Copied feedback data for ${feedbackUri}`);
        }
    };


    /**
     * Update existing feedback data in organization graph.
     * This deletes the old feedback data and copies the new version from LDES graph.
     * Enriched data is ignored and stays the same.
     * Uses a single atomic DELETE/INSERT operation to prevent data loss.
     */
    static updateFeedbackInOrganizationGraph = async function (feedbackUri, targetGraph) {
        if (!feedbackUri)
            throw 'feedbackUri cannot be null.';
        if (!targetGraph)
            throw 'targetGraph cannot be null.';

        await update(`
            PREFIX schema: <https://schema.org/>
            PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
            PREFIX lpdcExt: <https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#>

            DELETE {
                GRAPH ${sparqlEscapeUri(targetGraph)} {
                    ${sparqlEscapeUri(feedbackUri)} ?p ?o .
                    ?o ?pp ?nested .
                }
            }
            INSERT {
                GRAPH ${sparqlEscapeUri(targetGraph)} {
                    ${sparqlEscapeUri(feedbackUri)} ?pNew ?oNew .
                    ?oNew ?ppNew ?nestedNew .
                }
            }
            WHERE {
                {
                    GRAPH ${sparqlEscapeUri(targetGraph)} {
                        ${sparqlEscapeUri(feedbackUri)} ?p ?o .
                        FILTER (?p NOT IN (schema:actionStatus, schema:result, skos:primarySubject, lpdcExt:receiverBestuurseenheid))
                        OPTIONAL { ?o ?pp ?nested . }
                    }
                }
                {
                    GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                        ${sparqlEscapeUri(feedbackUri)} ?pNew ?oNew .
                        OPTIONAL { ?oNew ?ppNew ?nestedNew . }
                    }
                }
            }
        `);

        if (DEBUG) {
            console.log(`  ✓ Updated feedback data for ${feedbackUri} in graph ${targetGraph}`);
        }
    };


    /**
     * Mark a snapshot as processed by creating a marker in the LDES graph.
     */
    static markSnapshotAsProcessed = async function (snapshotUri) {
        if (!snapshotUri)
            throw 'snapshotUri cannot be null.';

        const markerUri = `http://mu.semte.ch/vocabularies/ext/processed-snapshot-marker/${uuid()}`;

        await update(`
            PREFIX lpdcExt: <https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#>
            PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>

            INSERT DATA {
                GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                    ${sparqlEscapeUri(markerUri)} a lpdcExt:VersionedLdesSnapshotProcessedMarker ;
                        ext:processedSnapshot ${sparqlEscapeUri(snapshotUri)} .
                }
            }
        `);

        console.log(`Marked snapshot ${snapshotUri} as processed`);
    };
}

export default LdesRepository;