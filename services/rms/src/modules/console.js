const dateformat = require('dateformat');
global.TRACE_MAX_LENGTH = 0;

module.exports = () => {
    console.RESET = "\x1b[0m",
    console.BRIGHT = "\x1b[1m";

    console.BLACK = "\x1b[30m";
    console.RED = "\x1b[31m";
    console.GREEN = "\x1b[32m";
    console.YELLOW = "\x1b[33m";
    console.BLUE = "\x1b[34m";
    console.MAGENTA = "\x1b[35m";
    console.CYAN = "\x1b[36m";
    console.WHITE = "\x1b[37m";
  
    console.bBLACK = "\x1b[40m";
    console.bRED = "\x1b[41m";
    console.bGREEN = "\x1b[42m";
    console.bYELLOW = "\x1b[43m";
    console.bBLUE = "\x1b[44m";
    console.bMAGENTA = "\x1b[45m";
    console.bCYAN = "\x1b[46m";
    console.bWHITE = "\x1b[47m";

    console.wrap = (content, colorCode) => {
        return colorCode + content + console.RESET;
    };

    console.wlog = (content, colorCode) => {
        console.log(colorCode + content + console.RESET);
    };

    const shorten = (value, newLineLimit = null) => {
        switch(typeof value) {
            case 'string': 
                return value;
            case 'object':
                if(value instanceof Error) {
                    return value.message;
                }
            default:
                try {
                    let stringifiedContent = JSON.stringify(value);
                    if(newLineLimit && stringifiedContent.length > newLineLimit) {
                        return '\n' + JSON.stringify(param, null, 4);
                    }
                    return stringifiedContent;
                } catch (err) {
                    return "[Circular Object]";
                }
        }
    };

    const tracer = () => {
        const priorStackTrace = Error.prepareStackTrace;
        Error.prepareStackTrace = (err, stack) => (
            stack.map(frame => ({
                file: frame.getFileName(),
                column: frame.getColumnNumber(),
                line: frame.getLineNumber(),
                functionName: frame.getFunctionName()
            }))
        );

        const errorStack = new Error().stack;
        Error.prepareStackTrace = priorStackTrace;

        const slicedCallStack = errorStack.slice(3, 5);
        let callStackTraceMsg = slicedCallStack.map(entry => {
            let {column, line, file} = entry;
            if(file === null) return "null";
            
            let pathSegments = file.split('\\');
            let lastSegment = pathSegments.last();
            let cleanFileName = lastSegment.split('.').first();
            let shortenFileName = cleanFileName.split('/').last();

            return `${shortenFileName}(${line})`;
        }).reverse().join(".");

        global.TRACE_MAX_LENGTH = Math.max(global.TRACE_MAX_LENGTH, callStackTraceMsg.length);
        return callStackTraceMsg;
    };

    const logger = (level, ...arg) => {
        let currentDate = new Date();
        let levelColorCode = getColorCodeByLevel(level);

        let timeSegment = dateformat(currentDate, 'yyyy/mm/dd HH:MM:ss.l');
        let levelSegment = console.wrap(level.padEnd(6, ' '), levelColorCode);
        let traceSegment = console.wrap(tracer().padEnd(global.TRACE_MAX_LENGTH, ' '), console.YELLOW);
        let contentSegment = arg.map(argument => shorten(argument)).join(" ");

        console.log(`${timeSegment} ${levelSegment} ${traceSegment} ${contentSegment}`);
    }

    console.debug = (...arg) => logger('DEBUG', ...arg);
    console.info = (...arg) => logger('INFO', ...arg);
    console.warn = (...arg) => logger('WARN', ...arg);
    console.error = (...arg) => logger('ERROR', ...arg);
    console.system = (...arg) => logger('SYSTEM', ...arg);
    console.shorten = shorten;
}

function getColorCodeByLevel(level) {
    switch(level){
        case 'DEBUG': return console.MAGENTA;
        case 'INFO': return console.CYAN;
        case 'WARN': return console.YELLOW;
        case 'ERROR': return console.RED;
        case 'SYSTEM': return console.BLUE;
        default: return console.RESET;
    }
}