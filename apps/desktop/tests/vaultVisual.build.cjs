// Bundles only synthetic UI; does not load env, user data, or app services.
process.env.NODE_ENV="test";
const path=require("node:path"),fs=require("node:fs"),webpack=require("webpack");
const output=path.resolve(__dirname,"../../../.tmp/vault-visual");
webpack({mode:"development",devtool:false,entry:path.join(__dirname,"fixtures/vaultPreview.jsx"),output:{path:output,filename:"preview.js"},resolve:{extensions:[".js",".jsx"],modules:[path.resolve(__dirname,"../node_modules"),path.resolve(__dirname,"../src")]},plugins:[new webpack.NormalModuleReplacementPlugin(/IpcSender$/,path.join(__dirname,"fixtures/vaultPreviewIpc.js"))],module:{rules:[{test:/\.jsx?$/,exclude:/node_modules/,use:{loader:require.resolve("babel-loader"),options:{presets:[require.resolve("babel-preset-react-app")]}}},{test:/\.s?css$/,use:[require.resolve("style-loader"),require.resolve("css-loader"),{loader:require.resolve("sass-loader"),options:{implementation:require("sass")}}]},{test:/\.(png|svg|woff2?|ttf)$/,type:"asset/resource"}]}},(error,stats)=>{
 if(error||stats.hasErrors()){process.stderr.write(error?String(error):stats.toString({all:false,errors:true}));process.exitCode=1;return;}
 fs.writeFileSync(path.join(output,"index.html"),'<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#101216;color:#edf1f7;font-family:Segoe UI,sans-serif}button,input{font-family:inherit}</style><div id="root"></div><script>window.fixtureErrors=[];window.addEventListener("error",e=>window.fixtureErrors.push(e.message));</script><script src="preview.js"></script>');
 process.stdout.write("Synthetic UI bundle ready\n");
});
