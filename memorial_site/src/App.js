import "./App.css";

function App() {
  return (
    <div className="App">
      <div className="header-bg">
        <svg width="100%" height="100%" version="1.1" xmlns="http://www.w3.org/2000/svg">
          {/* 그라디언트 정의 */}
          <defs>
            <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" style={{ stopColor: "rgb(255, 255, 255)", stopOpacity: 1 }} />
              <stop offset="100%" style={{ stopColor: "rgb(0, 0, 255)", stopOpacity: 1 }} />
            </linearGradient>
          </defs>

          {/* 둥글게 틀어지는 폴리곤 그리기 */}
          <path d="M0,0 L0,100 A70,70 0 0,1 70,100 L100,0 Z" stroke="black" strokeWidth="1" fill="url(#gradient)" />
        </svg>
      </div>
    </div>
  );
}

export default App;
