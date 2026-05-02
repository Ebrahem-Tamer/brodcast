const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'storage.json');

const defaultState = {
    bots: [],
    broadcasts: [],
    recipients: [],
    settings: []
};

function ensureStorage() {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    if (!fs.existsSync(dataFile)) {
        fs.writeFileSync(dataFile, JSON.stringify(defaultState, null, 2));
    }
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function loadState() {
    ensureStorage();

    try {
        const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
        return { ...defaultState, ...parsed };
    } catch {
        fs.writeFileSync(dataFile, JSON.stringify(defaultState, null, 2));
        return clone(defaultState);
    }
}

function saveState(state) {
    ensureStorage();
    fs.writeFileSync(dataFile, JSON.stringify(state, null, 2));
}

function generateId() {
    return crypto.randomUUID();
}

function matchesValue(actual, expected) {
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
        if ('$nin' in expected) {
            return !expected.$nin.includes(actual);
        }
    }

    return actual === expected;
}

function matchesFilter(doc, filter = {}) {
    return Object.entries(filter).every(([key, expected]) => matchesValue(doc[key], expected));
}

function applyUpdate(target, update = {}) {
    for (const [key, value] of Object.entries(update)) {
        if (key === '$set' && value && typeof value === 'object') {
            Object.assign(target, value);
            continue;
        }

        if (key === '$inc' && value && typeof value === 'object') {
            for (const [field, amount] of Object.entries(value)) {
                target[field] = Number(target[field] || 0) + Number(amount || 0);
            }
            continue;
        }

        target[key] = value;
    }
}

function projectDoc(doc, projection) {
    if (!projection) return clone(doc);

    const fields = String(projection).split(/\s+/).filter(Boolean);
    const projected = {};

    for (const field of fields) {
        if (field in doc) {
            projected[field] = clone(doc[field]);
        }
    }

    if ('_id' in doc) {
        projected._id = doc._id;
    }

    return projected;
}

function createDocument(collectionName, doc) {
    const wrapped = clone(doc);

    wrapped.save = async () => {
        const state = loadState();
        const collection = state[collectionName];
        const index = collection.findIndex(item => item._id === wrapped._id);

        if (index !== -1) {
            const serializable = clone(wrapped);
            delete serializable.save;
            collection[index] = serializable;
            saveState(state);
        }

        return wrapped;
    };

    return wrapped;
}

function createModel(collectionName, defaults = {}) {
    return class JsonModel {
        static async countDocuments(filter = {}) {
            const state = loadState();
            return state[collectionName].filter(doc => matchesFilter(doc, filter)).length;
        }

        static async find(filter = {}, projection) {
            const state = loadState();
            return state[collectionName]
                .filter(doc => matchesFilter(doc, filter))
                .map(doc => projectDoc(doc, projection));
        }

        static async findOne(filter = {}) {
            const state = loadState();
            const found = state[collectionName].find(doc => matchesFilter(doc, filter));
            return found ? createDocument(collectionName, found) : null;
        }

        static async create(doc) {
            const state = loadState();
            const created = {
                _id: generateId(),
                createdAt: new Date().toISOString(),
                ...clone(defaults),
                ...clone(doc)
            };

            state[collectionName].push(created);
            saveState(state);
            return createDocument(collectionName, created);
        }

        static async findById(id) {
            const state = loadState();
            const found = state[collectionName].find(doc => doc._id === id);
            return found ? createDocument(collectionName, found) : null;
        }

        static async findByIdAndDelete(id) {
            const state = loadState();
            const index = state[collectionName].findIndex(doc => doc._id === id);

            if (index === -1) return null;

            const [removed] = state[collectionName].splice(index, 1);
            saveState(state);
            return clone(removed);
        }

        static async findByIdAndUpdate(id, update = {}) {
            const state = loadState();
            const doc = state[collectionName].find(item => item._id === id);

            if (!doc) return null;

            applyUpdate(doc, update);
            saveState(state);
            return createDocument(collectionName, doc);
        }

        static async findOneAndUpdate(filter = {}, update = {}, options = {}) {
            const state = loadState();
            let doc = state[collectionName].find(item => matchesFilter(item, filter));

            if (!doc && options.upsert) {
                doc = {
                    _id: generateId(),
                    createdAt: new Date().toISOString(),
                    ...clone(defaults),
                    ...clone(filter)
                };
                state[collectionName].push(doc);
            }

            if (!doc) return null;

            applyUpdate(doc, update);
            saveState(state);
            return createDocument(collectionName, doc);
        }

        static async updateMany(filter = {}, update = {}) {
            const state = loadState();
            let modifiedCount = 0;

            for (const doc of state[collectionName]) {
                if (!matchesFilter(doc, filter)) continue;
                applyUpdate(doc, update);
                modifiedCount += 1;
            }

            saveState(state);
            return { modifiedCount };
        }

        static async deleteMany(filter = {}) {
            const state = loadState();
            const before = state[collectionName].length;
            state[collectionName] = state[collectionName].filter(doc => !matchesFilter(doc, filter));
            saveState(state);
            return { deletedCount: before - state[collectionName].length };
        }
    };
}

module.exports = {
    createModel
};
