import {sparqlEscapeUri, sparqlEscapeDateTime, sparqlEscapeString, sparqlEscapeInt, uuid} from 'mu';
import {querySudo as query, updateSudo as update} from '@lblod/mu-auth-sudo';
import {subMonths} from "date-fns";
import {
    ERROR_EXPIRATION_MONTHS, IPDC_JSON_ENDPOINT,
    IPDC_STATUS_PREDICATE,
    IPDC_STATUS_START_URI, IPDC_X_API_KEY,
    LDES_GRAPH,
    LPDC_STATUS_END_URI,
    LPDC_STATUS_PREDICATE,
    LPDC_STATUS_PUBLISHED_URI, RETRY_COUNTER_LIMIT
} from "../../env.js";

class PublishRepository {

    /**
     * Get feedback that is ready to send to IPDC.
     * Retrieves feedback with LPDC end status and IPDC start status that hasn't exceeded retry limits.
     */
    static getFeedbackToPublish = async function () {
        const result = await query(`
            PREFIX schema2: <https://schema.org/>
            PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
            PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
            
            SELECT ?feedback ?van ?antwoord ?retryCount WHERE {
                GRAPH ?g {
                     ?feedback a schema2:Conversation .
                     ?feedback ${sparqlEscapeUri(LPDC_STATUS_PREDICATE)} ${sparqlEscapeUri(LPDC_STATUS_END_URI)}.
                     ?feedback ${sparqlEscapeUri(IPDC_STATUS_PREDICATE)} ${sparqlEscapeUri(IPDC_STATUS_START_URI)}.
                     ?feedback mu:uuid ?uuid .
                     ?feedback schema2:suggestedAnswer ?answer .
                     ?answer schema2:resultComment ?antwoord .
                     ?answer schema2:agent ?van .
                OPTIONAL {
                    ?feedback ext:publishRetryCount ?retryCount .
                    }
                }  
                FILTER(?g != ${sparqlEscapeUri(LDES_GRAPH)})
                FILTER(COALESCE(?retryCount, 0) < ${sparqlEscapeInt(RETRY_COUNTER_LIMIT)})
                }
                        `);

        if (result.results.bindings.length === 0) {
            return [];
        }

        return result.results.bindings.map(binding => (
            {
                retryCount: binding.retryCount?.value,
                payload: {
                    feedbackId: binding.feedback?.value,
                    antwoord: {
                        van: binding.van?.value, antwoord: binding.antwoord?.value
                    }
                }
            }
        ));
    };

    /**
     * Remove old publication errors from the database.
     * Deletes publication error records that are older than the configured expiration period.
     */
    static async clearPublicationErrors() {
        const yearAgo = subMonths(new Date(), ERROR_EXPIRATION_MONTHS);
        const clearPublicationErrors = `
          PREFIX schema: <http://schema.org/>
          PREFIX lpdcExt: <https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#>
          
          DELETE {
            GRAPH <http://mu.semte.ch/graphs/lpdc/ipdc-feedback-publication-errors> {
                ?s ?p ?o.
            }
          } WHERE {
            GRAPH <http://mu.semte.ch/graphs/lpdc/ipdc-feedback-publication-errors> {
                ?s a lpdcExt:FeedbackPublicationError ;
                  ?p ?o ;
                  schema:dateCreated ?dateCreated .
            }
            FILTER ( ?dateCreated < ${sparqlEscapeDateTime(yearAgo)} )
          }
        `;
        await update(clearPublicationErrors);
    }

    /**
     * Send feedback data to IPDC endpoint via HTTP POST.
     * Creates a publication error record if the request fails.
     */
    static async sendFeedbackToIpdc(feedbackData) {
        const headers = {
            'x-api-key': IPDC_X_API_KEY,
            'Content-Type': 'application/ld+json',
            'Accept': 'application/ld+json'

        };

        const response = await fetch(IPDC_JSON_ENDPOINT, {
            method: "POST",
            headers,
            body: JSON.stringify(feedbackData),
        });

        if (!response.ok) {
            const responseBody = await PublishRepository.getResponseBody(response);
            try {
                await PublishRepository.createPublicationError(response.status, JSON.stringify(responseBody), JSON.stringify(feedbackData));
            } catch (e) {
                console.log('Could not save publicationError', e);
            }
            throw new Error("Something went wrong when submitting to IPDC: \n" + "IPDC response: " + JSON.stringify(responseBody) + "\n"
                + "Response status code: " + response.status + "\n"
                + "Data sent to IPDC: " + JSON.stringify(feedbackData));
        } else {
            console.log("Successfully sent data to IPDC: \n" + JSON.stringify(feedbackData));
        }
    }

    /**
     * Create a publication error record in the database.
     * Stores error details including status code, error message, and the payload that failed.
     */
    static async createPublicationError(errorCode, errorMessage, payload) {
        const publicationErrorIri = `http://data.lblod.info/id/feedback-publication-error/${uuid()}`;

        const triples = [
            `${sparqlEscapeUri(publicationErrorIri)} a lpdcExt:FeedbackPublicationError .`,
            errorCode ? `${sparqlEscapeUri(publicationErrorIri)} http:statusCode ${sparqlEscapeInt(errorCode)} .` : undefined,
            errorMessage ? `${sparqlEscapeUri(publicationErrorIri)} schema:error ${sparqlEscapeString(errorMessage)} .` : undefined,
            payload ? `${sparqlEscapeUri(publicationErrorIri)} http:body ${sparqlEscapeString(payload)} .` : undefined,
            `${sparqlEscapeUri(publicationErrorIri)} schema:dateCreated ${sparqlEscapeDateTime(new Date())} .`
        ].filter(it => !!it);

        const insertPublicationError = `
          PREFIX schema: <http://schema.org/>
          PREFIX http: <http://www.w3.org/2011/http#>
          PREFIX lpdcExt: <https://productencatalogus.data.vlaanderen.be/ns/ipdc-lpdc#>

          
          INSERT DATA {
            GRAPH <http://mu.semte.ch/graphs/lpdc/ipdc-feedback-publication-errors> {
              ${triples.join("\n")}
            }
          }`;
        await update(insertPublicationError);
    }

    /**
     * Parse HTTP response body.
     * Attempts to parse as JSON, returns plain text wrapped in object if parsing fails.
     */
    static async getResponseBody(response) {
        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch (e) {
            return {message: text}
        }
    }

    /**
     * Update feedback status after successful publication to IPDC.
     * Changes status to published and records the publication timestamp.
     */
    static async updateFeedbackOnSucces(feedbackUri) {
        if (!feedbackUri)
            throw new Error('feedback URI cannot be null.');

        const updateFeedbackQuery = `
          PREFIX schema2: <https://schema.org/>
          PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
          
          DELETE {
            GRAPH ?g {
              ${sparqlEscapeUri(feedbackUri)} ${sparqlEscapeUri(LPDC_STATUS_PREDICATE)} ?oldValue.
            }
          }
          INSERT {
            GRAPH ?g {
              ${sparqlEscapeUri(feedbackUri)} ${sparqlEscapeUri(LPDC_STATUS_PREDICATE)} ${sparqlEscapeUri(LPDC_STATUS_PUBLISHED_URI)}.
              ${sparqlEscapeUri(feedbackUri)} schema2:datePublished ${sparqlEscapeDateTime(new Date())}.
            }
          }
          WHERE {
            GRAPH ?g {
                ${sparqlEscapeUri(feedbackUri)} a schema2:Conversation.
                ${sparqlEscapeUri(feedbackUri)} mu:uuid ?uuid.
                ${sparqlEscapeUri(feedbackUri)} ${sparqlEscapeUri(LPDC_STATUS_PREDICATE)} ?oldValue.
            }
          }
          `;
        await update(updateFeedbackQuery);
    }

    /**
     * Increment the retry counter for a feedback publication attempt.
     * Increases the counter by 1, initializing to 1 if it doesn't exist.
     */
    static async incrementRetryCounter(feedbackUri) {
        if (!feedbackUri)
            throw new Error('feedback URI cannot be null.');

        await update(`
            PREFIX schema2: <https://schema.org/>
            PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
            PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
              
            DELETE {
              GRAPH ?g {
                ${sparqlEscapeUri(feedbackUri)} ext:publishRetryCount ?counter .
              }
            }
            INSERT {
              GRAPH ?g {
                ${sparqlEscapeUri(feedbackUri)} ext:publishRetryCount ?incrementedCounter .
              }
            }
            WHERE {
              GRAPH ?g {
                ${sparqlEscapeUri(feedbackUri)} mu:uuid ?uuid.
                ${sparqlEscapeUri(feedbackUri)} a schema2:Conversation.
             
                OPTIONAL {
                  ${sparqlEscapeUri(feedbackUri)} ext:publishRetryCount ?counter .
                }
                BIND (COALESCE(?counter, 0)+1 AS ?incrementedCounter)
              }
            }
      `);
    }

    /**
     * Find OVO URI for a bestuurseenheid via its OVO code.
     * Extracts the OVO code from the bestuurseenheid and constructs the official OVO URI.
     */
    static findOvoUriFromBestuurseenheidViaOvoCode = async function (bestuurseenheidUri) {
        if (!bestuurseenheidUri)
            throw new Error('bestuurseenheid URI cannot be null.');

        const result = await query(`
          PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
          PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
          PREFIX adms: <http://www.w3.org/ns/adms#>
          PREFIX generiek: <https://data.vlaanderen.be/ns/generiek#>

          SELECT ?ovoCode WHERE {
              ${sparqlEscapeUri(bestuurseenheidUri)} a besluit:Bestuurseenheid .
              ${sparqlEscapeUri(bestuurseenheidUri)} adms:identifier ?s .
              ?s skos:notation "OVO-nummer".
              ?s generiek:gestructureerdeIdentificator ?strucID .
              ?strucID generiek:lokaleIdentificator ?ovoCode .
          }
          LIMIT 1
      `);

        if (result.results.bindings.length === 0) {
            throw new Error(`x Can not find ovo code for ${bestuurseenheidUri}`)
        }

        return "https://data.vlaanderen.be/id/organisatie/" + result.results.bindings[0].ovoCode.value;
    };

    /**
     * Find OVO concept for a bestuurseenheid.
     * Looks up the skos:Concept that matches the bestuurseenheid's OVO code.
     */
    static findOvoConceptFromBestuurseenheid = async function (bestuurseenheidUri) {
        if (!bestuurseenheidUri)
            throw new Error('bestuurseenheid URI cannot be null.');

        const result = await query(`
          PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
          PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
          PREFIX adms: <http://www.w3.org/ns/adms#>
          PREFIX generiek: <https://data.vlaanderen.be/ns/generiek#>

          SELECT ?ovoConcept WHERE {
              ${sparqlEscapeUri(bestuurseenheidUri)} a besluit:Bestuurseenheid .
              ${sparqlEscapeUri(bestuurseenheidUri)} adms:identifier ?s .
              ?s skos:notation "OVO-nummer".
              ?s generiek:gestructureerdeIdentificator ?strucID .
              ?strucID generiek:lokaleIdentificator ?ovoCode .
              
              ?ovoConcept a skos:Concept.
              ?ovoConcept skos:notation ?ovoCode.
          }
          LIMIT 1
      `);

        if (result.results.bindings.length === 0) {
            throw new Error(`x Can not find ovo concept for ovoCode of ${bestuurseenheidUri}`);
        }

        return result.results.bindings[0].ovoConcept.value;
    };

}

export default PublishRepository;