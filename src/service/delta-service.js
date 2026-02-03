import InstanceRepository from '../repository/instance-repository';


class DeltaService {

  /**
   * Process the given list of feedback uri's
   */
  static process = async function(uris, flagged) {
    let instances = await Promise.all(uris.map(uri => InstanceRepository.findInstanceByURI(uri)));
    await Promise.allSettled(instances.map(instance => InstanceRepository.updateInstanceFlagged(instance, flagged)));
    console.log('Processed delta.');
  };
}

export default DeltaService;