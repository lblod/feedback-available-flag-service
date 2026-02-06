import InstanceRepository from '../repository/instance-repository';
import {STATUS_PREDICATE, STATUS_URI} from '../../env';


class DeltaService {

  /**
   * Process the given list of feedback uri's
   */
  static process = async function(uris, flagged) {
    let instances = await Promise.all(uris.map(uri => InstanceRepository.findInstanceByURI(uri)));

    if (flagged) {
      await Promise.allSettled(instances.map(instance => InstanceRepository.updateInstanceFlagged(instance, true)));
    } else {
      await Promise.allSettled(
        instances.map(async instance => {
          const hasActiveFeedback = await InstanceRepository.hasActiveFeedbacks(instance, STATUS_PREDICATE, STATUS_URI);
          if (hasActiveFeedback) {
            await InstanceRepository.updateInstanceFlagged(instance, true);
          } else {
            await InstanceRepository.updateInstanceFlagged(instance, false);
          }
        })
      );
    }

    console.log('Processed delta.');
  };
}

export default DeltaService;