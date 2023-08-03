const Promise = require('bluebird');
const { spawn } = require('child_process');
const { EventEmitter } = require('stream');
const fs = Promise.promisifyAll(require('fs'));
// const pidusage = require('pidusage');

// const config = require('../config')._(process.env.NODE_ENV);
// const logger = require('../lib/logger').logger('lib/predict-manager-v3');
const logger = {
  debug: (...x) => console.log(...x),
};

const RECYCLE_N = 5000; // || config.SWIFT.RECYCLE_N || 1000;
const SPAWN_OPTIONS = {
  detached: false,
  stdio: ['pipe', 'pipe', process.stderr],
  killSignal: 'SIGHUP',
  windowsHide: false,
};

const url2Path = url => {
  const path = url.replace(/^file:\/\//, '');
  return path;
};

const spawn2 = ({ app, args }) => {
  logger.debug(`spawn2: ${app} ${args.join(' ')}`);

  if (app.endsWith('.swift')) {
    return spawn('swift', [app, ...args], SPAWN_OPTIONS);
  }

  return spawn(app, args, SPAWN_OPTIONS);
};

const PredictManagerV3 = ({
  app = '../detect3',
  args = [],
  removeAfterExecution = true,
  version = 3,
  model = null,
  compiledModelUrl = null,
  labels = [],
}) => {
  let predict = spawn2({ app, args });
  const event = new EventEmitter();
  const predictEvent = new EventEmitter();
  let buffer = [];
  let count = 0;
  let isTermination = false;
  let ready = false;

  process.on('uncaughtException', e => {
    predict.kill('SIGTERM');
  });

  const register = () => {
    predict.stdin.setEncoding('utf-8');

    predict.stdout.on('data', data => {
      const str = data.toString('utf-8');
      buffer.push(str);
      if (str.endsWith('\n')) {
        const json = JSON.parse(buffer.join(''));
        buffer = [];
        if (!ready) {
          event.emit('done', json);
        }
        else {
          predictEvent.emit('done', json);
        }
        // pidusage(predict.pid, (err, stats) => {
        //   if (err) {
        //     logger.error(err);
        //   }
        //   else {
        //     if (stats.memory > 500000000) {
        //       logger.debug(`kill because of pidusage ${JSON.stringify(stats)}`);
        //       kill();
        //     }
        //   }
        // });
      }
    });

    // predict.stderr.on('data', data => {
    //   console.error(data.toString('utf-8'));
    // });

    predict.on('close', async code => {
      logger.debug(`close ${code}`);
      // event.emit('close');

      if (!isTermination) {
        ready = false;
        buffer = [];
        predict = spawn2({ app, args });
        register();
      }
    });

    predict.on('exit', code => {
      logger.debug(`exit ${code}`);
      ready = false;
    });

    predict.on('error', (code, signal) => {
      logger.debug(`error ${code} ${signal}`);
    });

    event.once('done', async json => {
      if (!json.ready) {
        logger.error(JSON.stringify(json));
        process.exit(-1);
      }

      if (compiledModelUrl && fs.existsSync(url2Path(compiledModelUrl))) {
        const r = await sendCommand({ op: 'load-compiled-model', compiledModelUrl, labels });
        if (!r.success) {
          logger.error(JSON.stringify(json));
          process.exit(-1);
        }
        logger.debug(`load-compiled-model ${JSON.stringify(r)}`);
      }
      else {
        const r = await sendCommand({ op: 'load-model', filename: model, labels });
        if (!r.success) {
          logger.error(JSON.stringify(json));
          process.exit(-1);
        }

        compiledModelUrl = r.compiledModelUrl;
        logger.debug(`load-model ${JSON.stringify(r)}`);
      }

      ready = true;
    });
  };

  register();

  const sendCommand = json => new Promise((resolve, reject) => {
    const command = JSON.stringify(json);
    event.once('done', json => resolve(json));
    predict.stdin.write(`${command}\n`);
  });

  const waitUntilReady = async () => {
    while (!ready) {
      await Promise.delay(1000);
    }
  };

  const kill = () => {
    ready = false;
    predict.kill('SIGHUP');
  };

  const predictHandler = filename => new Promise(async (resolve, reject) => {
    await waitUntilReady();
    // logger.debug(`predict ${filename}`);
    buffer = [];
    let emitted = false;

    predict.stdin.write(`${JSON.stringify({ op: 'predict', filename })}\n`);

    const timeoutRef = setTimeout(() => {
      if (!emitted) {
        if (ready) {
          return predictHandler(filename);
        }

        if (removeAfterExecution) {
          try { fs.unlinkAsync(filename); } catch (e) { logger.warn(e); }
        }
        logger.debug('recycle due to timeout');
        kill();
        resolve({ error: 'timeout' });
      }
    }, 30000);

    predictEvent.once('done', json => {
      emitted = true;

      clearTimeout(timeoutRef);
      if (removeAfterExecution) {
        try { fs.unlinkAsync(filename); } catch (e) { logger.warn(e); }
      }

      resolve(json);

      // recycle
      count += 1;
      if (count % RECYCLE_N === 0) {
        logger.debug('normal recycle');
        kill();
      }
    });
  });

  process.on('SIGINT', () => {
    logger.debug('Caught interrupt signal');
    const path = url2Path(compiledModelUrl);
    if (fs.existsSync(path)) {
      fs.rmSync(path, { recursive: true });
    }

    process.exit(-1);
  });

  return {
    predict: predictHandler,
    stats: async () => {
      buffer = [];
      return await sendCommand({ op: 'stats' });
    },
    close: async () => {
      isTermination = true;
      await sendCommand({ op: 'exit' });
      return true;
    },
    unloadModel: () => {
      const path = url2Path(compiledModelUrl);
      if (fs.existsSync(path)) {
        fs.rmSync(path, { recursive: true });
      }
    },
  }
};

module.exports = PredictManagerV3;
