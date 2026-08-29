import moment from 'moment';

export default {
    toRelativeTime: (timestamp, fallback) => {
        if(!timestamp) {
            return fallback || 'Unknown';
        }

        let current = Date.now();
        let diff = (current - timestamp) / 1000;

        let diffSec = Math.floor(diff);
        let converted;

        if(diffSec === 0){
            return 'Just now';
        }else if(diffSec < 60){
            converted = diffSec;
            return `${converted} second${converted > 1 ? 's' :''} ago`;
        }else if(diffSec < 60 * 60){
            converted = Math.floor(diffSec / (60));
            return `${converted} minute${converted > 1 ? 's' :''} ago`;
        }else if(diffSec < 60 * 60 * 24){
            converted = Math.floor(diffSec / (60 * 60));
            return `${converted} hour${converted > 1 ? 's' :''} ago`;
        }else if(diffSec < 60 * 60 * 24 * 30){
            converted = Math.floor(diffSec / (60 * 60 * 24));
            return `${converted} day${converted > 1 ? 's' :''} ago`;
        }else if(diffSec < 60 * 60 * 24 * 365){
            converted = Math.floor(diffSec / (60 * 60 * 24 * 30));
            return `${converted} month${converted > 1 ? 's' :''} ago`;
        }else if(diffSec > 0){
            converted = Math.floor(diffSec / (60 * 60 * 24 * 365));
            return `${converted} year${converted > 1 ? 's' :''} ago`;
        }else{
            return 'Future';
        }
    },
    fastInterval: (func, period) => {
        func();
        return setInterval(func, period);
    },
    formatDate: (timestamp) => {
        return moment(Number(timestamp)).format('YYYY.MM.DD hh:mm:ss A');
    },
    formatFileSize: (rawByte, precision = 0) => {
        const units = ['B', 'kB', 'MB', 'GB'];
        let unitIndex = 0;

        while(true) {
            if(rawByte < 1024 || unitIndex >= units.length - 1) break;
            rawByte /= 1024;
            unitIndex++;
        }

        return `${rawByte.toFixed(precision)}${units[unitIndex]}`;
    }
}