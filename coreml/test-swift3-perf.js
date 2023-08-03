const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));
const PredictManagerV3 = require('./predict-manager-v3');

const FILENAME = './416.jpeg';

(async () => {
  const pm = PredictManagerV3({
    app: './detect3',
    removeAfterExecution: false,
    version: 3,
    model: './cnr.mlmodel',
    labels: ["person", "bicycle", "car", "motorbike", "aeroplane", "bus", "train", "truck", "boat", "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "sofa", "pottedplant", "bed", "diningtable", "toilet", "tvmonitor", "laptop", "mouse", "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush"],
  });

  const output = await pm.predict(FILENAME);
  console.log(output);

  const startTime = Date.now();
  let count = 0;
  let objects = {};
  let seconds = 240 * 60;

  while (Date.now() - startTime <= seconds * 1000) {
    const a = await pm.predict(FILENAME);
    if (a.error) { console.log(a); }
    if (a.length === 0) { console.log(a); }
    if (!a[0]) { console.log(a); }
    objects[a[0].object] = objects[a[0].object] ? objects[a[0].object] + 1 : 1;
    count += 1;

    if (count % 10 === 0) {
      console.log(count / (Date.now() - startTime) * 1000);
    }
  }
  console.log(JSON.stringify(objects, null, 2));
  console.log(count / seconds);

  console.log(await pm.close());
  // await pm.stats();
})();
