import InstanceRepository from '../repository/instance-repository';


class DeltaService {

  /**
   * Process the given list of feedback uri's
   */
  static process = async function(uris, isNewFeedback) {
    let instances = await Promise.all(uris.map(uri => InstanceRepository.findInstanceByURI(uri)));

    if (isNewFeedback) {
      await Promise.allSettled(instances.map(instance => InstanceRepository.updateInstanceFlagged(instance, true)));
      await Promise.allSettled(uris.map(feedback => InstanceRepository.setProcessingStatus(feedback)));
    } else {
        await Promise.allSettled(uris.map(feedback => InstanceRepository.finishFeedback(feedback)));
        await Promise.allSettled(
        instances.map(async instance => {
          const hasActiveFeedback = await InstanceRepository.hasActiveFeedbacks(instance);
          if (!hasActiveFeedback) {
            await InstanceRepository.updateInstanceFlagged(instance, false);
          }
        })
      );
    }

    console.log('Processed delta.');
  };
}

export default DeltaService;