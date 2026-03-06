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

    getInsertsForLdes() {
        return this.inserts
            .filter(t => t.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" && t.object.value === "https://schema.org/Conversation" && t.graph.value === LDES_GRAPH)
            .map(t => t.subject.value);
    }

}

export default Delta;