/**
 * Extracts the final part of a given uri. Can be used to get ovo or uuid.
 */
export function extractFinalPartUri(uri) {
    if (!uri || typeof uri !== 'string') {
        throw 'URI must be a non-empty string';
    }

    const segments = uri.split('/');
    const code = segments[segments.length - 1];

    if (!code) {
        throw 'Could not extract from URI';
    }

    return code;
}

/**
 * Checks if a URI is a valid ovo Vlaanderen organization URI
 */
export function isOvoUri(uri) {
    if (!uri || typeof uri !== 'string') {
        return false;
    }
    const ovoUriPattern = /^https:\/\/data\.vlaanderen\.be\/id\/organisatie\/OVO\d+$/;
    return ovoUriPattern.test(uri);
}

/**
 * Get organization graph from bestuurseenheid uuid
 */
export function getOrganizationGraphFromUuid(uuid) {
    if (!uuid || typeof uuid !== 'string') {
        throw 'uuid must be a non-empty string';
    }

    return "http://mu.semte.ch/graphs/organizations/" + uuid + "/LoketLB-LPDCGebruiker";
}

/**
 * Transform ipdc instance to lpdc instance
 */
export function transformIpdcToLpdcUri(ipdcUri) {
    if (!ipdcUri || typeof ipdcUri !== 'string') {
        throw 'ipdcUri must be a non-empty string';
    }

    const segments = ipdcUri.split('/');
    const uuidIpdc = segments[segments.length - 1];

    return "http://data.lblod.info/id/public-service/" + uuidIpdc;
}