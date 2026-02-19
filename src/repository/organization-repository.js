import {sparqlEscapeUri, sparqlEscapeString, uuid} from 'mu';
import {querySudo as query, updateSudo as update} from '@lblod/mu-auth-sudo';
import {extractOrganizationCode, getOrganizationGraphFromUuid} from "../utils/uri-utils";
import {DEBUG} from "../../env";

const PUBLIC_GRAPH = 'http://mu.semte.ch/graphs/public';

class OrganizationRepository {

    /**
     * Check if an ovo organization exists as a skos:Concept in the database.
     * Returns the concept with its label and notation if it exists.
     */
    static findConceptByUri = async function (organizationUri) {
        if (!organizationUri)
            throw 'organizationUri cannot be null.';

        const result = await query(`
            PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

            SELECT ?concept ?label ?notation WHERE {
                GRAPH ${sparqlEscapeUri(PUBLIC_GRAPH)} {
                    VALUES ?concept { ${sparqlEscapeUri(organizationUri)} }
                    ?concept a skos:Concept .
                    OPTIONAL { ?concept skos:prefLabel ?label . }
                    OPTIONAL { ?concept skos:notation ?notation . }
                }
            }
        `);

        if (result.results.bindings.length === 0) {
            return null;
        }

        return {
            uri: result.results.bindings[0].concept.value,
            label: result.results.bindings[0].label?.value,
            notation: result.results.bindings[0].notation?.value
        };
    };

    /**
     * Find bestuurseenheid by organization URI using the OVO code from the concept's notation.
     * 1. Look up the concept to get its OVO code (skos:notation)
     * 2. Find structured identifier with that OVO code
     * 3. Find entity with that structured identifier (via gestructureerdeIdentificator)
     * 4. Find bestuurseenheid with that identifier (via adms:identifier)
     *
     * Returns the bestuurseenheid URI, graph and label.
     */
    static findBestuurseenheidByOvoCode = async function (ovoCode) {
        if (!ovoCode)
            throw 'ovo code cannot be null.';

        const result = await query(`
            PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
            PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
            PREFIX adms: <http://www.w3.org/ns/adms#>
            PREFIX generiek: <https://data.vlaanderen.be/ns/generiek#>
            PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

            SELECT ?bestuurseenheid ?uuid ?label WHERE {
                    ?strucID ?p ${sparqlEscapeString(ovoCode)} .

                    ?s generiek:gestructureerdeIdentificator ?strucID .

                    ?bestuurseenheid adms:identifier ?s .
                    ?bestuurseenheid a besluit:Bestuurseenheid .
                    ?bestuurseenheid mu:uuid ?uuid


                    OPTIONAL { ?bestuurseenheid skos:prefLabel ?label . }
            }
        `);

        if (result.results.bindings.length === 0) {
            return null;
        }

        return {
            uri: result.results.bindings[0].bestuurseenheid.value,
            graph: getOrganizationGraphFromUuid(result.results.bindings[0].uuid.value),
            label: result.results.bindings[0].label?.value
        };
    };

    /**
     * Find bestuurseenheid by lpdc organization URI.
     *
     * Returns the bestuurseenheid URI, graph and label.
     */
    static findBestuurseenheidByUri = async function (uri) {
        if (!uri)
            throw 'uri cannot be null.';

        const result = await query(`
            PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
            PREFIX besluit: <http://data.vlaanderen.be/ns/besluit#>
            PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

            SELECT ?uuid ?label WHERE {
                    ${sparqlEscapeUri(uri)} a besluit:Bestuurseenheid .
                    ${sparqlEscapeUri(uri)} mu:uuid ?uuid
                    OPTIONAL {  ${sparqlEscapeUri(uri)} skos:prefLabel ?label . }
            }
        `);

        if (result.results.bindings.length === 0) {
            return null;
        }

        return {
            uri: uri,
            graph: getOrganizationGraphFromUuid(result.results.bindings[0].uuid.value),
            label: result.results.bindings[0].label?.value
        };
    };

    /**
     * Create a skos:Concept for an organization in the public graph.
     * Includes both prefLabel and notation (OVO code).
     */
    static createConcept = async function (organizationUri, label, notation) {
        if (!organizationUri)
            throw 'organizationUri cannot be null.';
        if (!label)
            throw 'label cannot be null.';
        if (!notation)
            throw 'notation cannot be null.';

        const conceptUuid = uuid();

        await update(`
            PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
            PREFIX mu: <http://mu.semte.ch/vocabularies/core/>

            INSERT DATA {
                GRAPH ${sparqlEscapeUri(PUBLIC_GRAPH)} {
                    ${sparqlEscapeUri(organizationUri)} a skos:Concept ;
                        skos:prefLabel ${sparqlEscapeString(label)} ;
                        skos:notation ${sparqlEscapeString(notation)} ;
                        mu:uuid ${sparqlEscapeString(conceptUuid)} .
                }
            }
        `);

        if (DEBUG) {
            console.log(`Created concept for organization ${organizationUri} with label "${label}" and notation "${notation}"`);
        }

        return {
            uri: organizationUri,
            label: label,
            notation: notation,
        };
    };

    /**
     * Fetch organization details from data.vlaanderen.be
     *
     * Expected to return an object with:
     * - uri: the organization URI
     * - label: the human-readable name (prefLabel)
     * - notation: the OVO code (e.g., "OVO001995")
     *
     */
    static fetchFromDataVlaanderen = async function (organizationUri) {
        const ovoCode = extractOrganizationCode(organizationUri);
        try {
            const apiUrl = `https://api.wegwijs.vlaanderen.be/v1/search/organisations?q=ovoNumber:${ovoCode}`;
            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw `Failed to fetch from Wegwijs API: ${response.status} ${response.statusText}`;
            }

            const data = await response.json();

            if (!data || !Array.isArray(data) || data.length === 0) {
                throw `No organization found for OVO code: ${ovoCode}`;
            }

            return {
                uri: organizationUri,
                label: data[0].name,
                notation: data[0].ovoNumber
            };
        } catch (error) {
            console.error(`Error fetching organization data from Wegwijs API for ${organizationUri}:`, error);
            throw error;
        }
    };

    /**
     * Add notation to existing OVO concept
     */
    static updateOvoConceptWithNotation = async function (organizationUri, concept) {
        if (!organizationUri || !concept.notation || !concept.label)
            throw 'organizationUri and notation cannot be null.';
        await update(`
                        PREFIX skos: <http://www.w3.org/2004/02/skos/core#>

                        INSERT DATA {
                            GRAPH ${sparqlEscapeUri(PUBLIC_GRAPH)} {
                                ${sparqlEscapeUri(organizationUri)} skos:notation ${sparqlEscapeString(concept.notation)} .
                            }
                        }
                    `);

        return {
            uri: organizationUri,
            label: concept.label,
            notation: concept.notation
        };
    };
}

export default OrganizationRepository;