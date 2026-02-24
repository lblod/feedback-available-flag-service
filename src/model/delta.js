import flatten from 'lodash.flatten';
import {LDES_GRAPH} from "../../env";


class Delta {

    constructor(delta) {
        this.delta = delta;
    }

    get inserts() {
        return flatten(this.delta.map(changeSet => changeSet.inserts));
    }

    getInsertsFor(predicate, object) {
        return this.inserts
            .filter(t => t.predicate.value === predicate && t.object.value === object && t.graph.value !== LDES_GRAPH)
            .map(t => t.subject.value);
    }

}

export default Delta;