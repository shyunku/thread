const sha256 = require('sha256');
const {v4: uuidv4} = require('uuid');

module.exports = {
    validateField: function(data, field, reject = () => {console.warn('reject resolver not found.')}) {
        if(!data) {
            reject(`data is undefined.`);
            return false;
        }

        for(let fieldKey in field) {
            if(!data.hasOwnProperty(fieldKey)) {
                reject(`'${fieldKey}' field not found.`);
                return false;
            }
            let dataVal = data[fieldKey];
            if(field[fieldKey] === null) continue;
            let expectedDataType = typeof field[fieldKey];
            let acutalDataType = typeof dataVal;

            if(acutalDataType !== expectedDataType) {
                reject(`'${fieldKey}' field has invalid type '${acutalDataType}', expected: ${expectedDataType}`);
                return false;
            }
        }

        return true;
    },
    createAuthToken: (email) => {
        let seed = `${email}_${Date.now()}_${parseInt(Math.random() * 10000)}`;
        return sha256(seed);
    },
    hash: cypher => {
        return sha256(cypher);
    },
    uuid: () => {
        return uuidv4();
    }
};