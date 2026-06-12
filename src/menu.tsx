import { useNavigate } from "react-router-dom";

export default function Menu() {
  const navigate = useNavigate();

  return (
    <main className="flex flex-col gap-y-5 justify-start py-[7%] items-center w-full h-screen bg-[#f4f3ee]">
      <h1 className="text-[56px] mb-20 font-bold text-[#c15f3c]">
        Hand Tracking Prototype
      </h1>

      {/* <button
        className="w-[20%] py-4 bg-[#c15f3c] text-[18px] font-bold text-white rounded-full"
        onClick={() => {
          navigate("/tracker");
        }}
      >
        ทดสอบ Hand tracking
      </button> */}

      <button
        className="w-[20%] py-4 bg-[#c15f3c] text-[18px] font-bold text-white rounded-full"
        onClick={() => {
          navigate("/drawing");
        }}
      >
        วาดรูป
      </button>

      <button
        className="w-[20%] py-4 bg-[#c15f3c] text-[18px] font-bold text-white rounded-full"
        onClick={() => {
          navigate("/piano");
        }}
      >
        Piano
      </button>

      <button
        className="w-[20%] py-4 bg-[#c15f3c] text-[18px] font-bold text-white rounded-full"
        onClick={() => {
          navigate("/puzzle");
        }}
      >
        Puzzle
      </button>

      <button
        className="w-[20%] py-4 bg-[#c15f3c] text-[18px] font-bold text-white rounded-full"
        onClick={() => {
          navigate("/runner");
        }}
      >
        Runner
      </button>
    </main>
  );
}
