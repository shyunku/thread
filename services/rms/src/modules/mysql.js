const mysql = require('mysql2/promise');
const mysqlConfig = require('../config/mysql-config');

const pool = mysql.createPool(mysqlConfig);

const __database__ = {
    getConnection: async function() {
        try {
            const conn = await pool.getConnection();
            
            return {
                release: () => {
                    conn.release();
                },
                query: (sql, values) => {
                    console.info(`[Database] - Query: ` + mysql.format(sql, values));
                    return conn.query(sql, values);
                },
                beginTransaction: () => {
                    console.info(`[Database] - Begin transaction`);
                    return conn.beginTransaction();
                },
                commit: () => {
                    console.info(`[Database] - Commit`);
                    return conn.commit();
                },
                rollback: () => {
                    console.warn(`[Database] - Rollback`);
                    return conn.rollback();
                }
            }
        } catch (e) {
            throw e;
        }
    },
    query: async (sql, values = []) => {
        let conn = null;
    
        try {
            conn = await __database__.getConnection();
        } catch(err) {
            throw err;
        }

        try{
            let [results] = await conn.query(sql, values);
            return results;
        } catch(err) {
            throw err;
        } finally {
            conn.release();
        }
    }
}

module.exports = __database__;