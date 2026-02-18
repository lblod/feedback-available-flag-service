import {sparqlEscapeBool, sparqlEscapeUri, uuid} from 'mu';
import {querySudo as query, updateSudo as update} from '@lblod/mu-auth-sudo';
import {transformIpdcToLpdcUri} from "../utils/uri-utils";

const LDES_GRAPH = 'http://mu.semte.ch/graphs/lpdc/conceptsnapshots-ldes-data/ipdc-feedback';

class LdesRepository {


    static findToProcessSnapshots = async function () {

        const result = await query( `
            SELECT ?snapshotUri WHERE {
                GRAPH ${sparqlEscapeUri("http://mu.semte.ch/graphs/lpdc/conceptsnapshots-ldes-data/ipdc-feedback")} {
                     ?snapshotUri a ${sparqlEscapeUri("https://schema.org/DataFeedItem")} .
                     ?snapshotUri <https://schema.org/dateCreated> ?generatedAtTime .
                }
                FILTER NOT EXISTS {
                GRAPH ${sparqlEscapeUri("http://mu.semte.ch/graphs/lpdc/conceptsnapshots-ldes-data/ipdc-feedback")} {
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
     * Copy feedback data from LDES graph to organization graph.
     * This recursively copies all triples where feedbackUri is the subject,
     * including nested blank nodes.
     */
    static copyFeedbackToOrganizationGraph = async function (feedbackUri, targetGraph) {
        if (!feedbackUri)
            throw 'feedbackUri cannot be null.';
        if (!targetGraph)
            throw 'targetGraph cannot be null.';

        console.log(`  Copying feedback data from LDES graph to ${targetGraph}`);

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
        if(instanceUri){
            transformedUri = transformIpdcToLpdcUri(instanceUri);
        }
        else{
            throw 'feedback has no instance linked to it.';
        }

        await update(`
          PREFIX schema: <https://schema.org/>

          INSERT {
          GRAPH ${sparqlEscapeUri(targetGraph)} {
              ${sparqlEscapeUri(feedbackUri)} ?p ?o .
              ?o ?pp ?nested .
          }
          }
          WHERE {
              {
                  GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                      ${sparqlEscapeUri(feedbackUri)} ?p ?o .
                      FILTER(?p != schema:about)
                      OPTIONAL { ?o ?pp ?nested . }
                  }
              }
              UNION
              {
                  GRAPH ${sparqlEscapeUri(LDES_GRAPH)} {
                      ${sparqlEscapeUri(feedbackUri)} schema:about ?originalAbout .
                  }
                  BIND(schema:about AS ?p)
                  BIND(${sparqlEscapeUri(transformedUri)} AS ?o)
              }
          }
      `);

        console.log(`  ✓ Copied feedback data for ${feedbackUri}`);
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