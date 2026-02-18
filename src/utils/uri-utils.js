/**
 * Extracts the ovo code from a Vlaanderen organization URI
 */
export function extractOrganizationCode(uri) {
  if (!uri || typeof uri !== 'string') {
    throw new Error('URI must be a non-empty string');
  }

  const segments = uri.split('/');
  const code = segments[segments.length - 1];

  if (!code) {
    throw new Error('Could not extract organization code from URI');
  }

  return code;
}


/**
 * Checks if a URI is a valid ovo Vlaanderen organization URI
 */
export function isOvoUri(uri) {
  console.log("start is OvoUri voor " + uri);
  if (!uri || typeof uri !== 'string') {
    console.log("geen uri of geen string");
    return false;
  }

  const ovoUriPattern = /^https:\/\/data\.vlaanderen\.be\/id\/organisatie\/OVO\d+$/;
  const bool = ovoUriPattern.test(uri);

  if(bool){
    console.log(uri + " is an ovo URI")
  }
  else{
    console.log(uri + " is geen ovo URI")
  }

  return bool;
}

/**
 * Get organization graph from bestuurseenheid uuid
 */
export function getOrganizationGraphFromUuid(uuid) {
  if (!uuid || typeof uuid !== 'string') {
    throw new Error('uuid must be a non-empty string');
  }

  return "http://mu.semte.ch/graphs/organizations/" + uuid + "/LoketLB-LPDCGebruiker";
}


/**
 * Transform ipdc instance to lpdc instance
 */
export function transformIpdcToLpdcUri(ipdcUri) {
  if (!ipdcUri || typeof ipdcUri !== 'string') {
    throw new Error('ipdcUri must be a non-empty string');
  }

  const segments = ipdcUri.split('/');
  const uuidIpdc = segments[segments.length - 1];

  return "http://data.lblod.info/id/public-service/" + uuidIpdc;
}

