module.exports = {
    ok: function(res, data, msg) {
        let result = {code: 200, data, msg};
        res.send(result);
    },
    fail: function(res, code, data, msg) {
        let result = {code, data, msg};
        res.send(result);
    },
};