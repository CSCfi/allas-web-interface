const path = require("path");

module.exports = {
  context: path.resolve(__dirname, ''),
  mode: "development",
  devtool: "source-map",
  output: {
    path: path.resolve(__dirname, ''),
  },
  entry: {
    s3upworker: {
      import: "./js/crypt-post-s3upload.js",
      filename: "./build/s3upworker-post.js",
      chunkLoading: false,
    },
    s3downworker: {
      import: "./js/crypt-post-s3download.js",
      filename: "./build/s3downworker-post.js",
      chunkLoading: false,
    },
  },
};
