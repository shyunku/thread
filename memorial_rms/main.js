const express = require("express");
const busboy = require("connect-busboy");
const app = express();
const pbip = require("public-ip");
const fs = require("fs");
const cors = require("cors");
require("dotenv").config();

const defaultRouter = require("./src/routers/default");
const adminRouter = require("./src/routers/admin");

const __array__ = require("./src/modules/array");
const __console__ = require("./src/modules/console");

console.log(`
███╗   ███╗███████╗███╗   ███╗ ██████╗ ██████╗ ██╗ █████╗ ██╗      ██████╗ ███╗   ███╗███████╗
████╗ ████║██╔════╝████╗ ████║██╔═══██╗██╔══██╗██║██╔══██╗██║      ██╔══██╗████╗ ████║██╔════╝
██╔████╔██║█████╗  ██╔████╔██║██║   ██║██████╔╝██║███████║██║█████╗██████╔╝██╔████╔██║███████╗
██║╚██╔╝██║██╔══╝  ██║╚██╔╝██║██║   ██║██╔══██╗██║██╔══██║██║╚════╝██╔══██╗██║╚██╔╝██║╚════██║
██║ ╚═╝ ██║███████╗██║ ╚═╝ ██║╚██████╔╝██║  ██║██║██║  ██║███████╗ ██║  ██║██║ ╚═╝ ██║███████║
╚═╝     ╚═╝╚══════╝╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝
`);

__array__();
__console__();

app.all("/*", (req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "X-Requested-With, Content-Type");
  next();
});

const PORT = parseInt(process.env.SERVER_PORT);
const server = app.listen(PORT, async () => {
  let ipv4 = await pbip.v4();
  console.info(`server opened at: http://${ipv4}:${PORT}`);
});

app.use(express.json());
app.use(cors());
app.use(busboy());
app.use(express.urlencoded({ extended: false }));

app.get("/", (req, res) => {
  res.send("success");
});

app.use("/default", defaultRouter);
app.use("/admin", adminRouter);
