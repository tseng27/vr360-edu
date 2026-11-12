import type { Tour } from "./protocol";

/** 示範導覽：三張由 scripts/generate-classroom-panoramas.py 產生的測試全景（無第三方版權、無 EXIF） */
export const DEMO_TOUR: Tour = {
  tourId: "demo-208",
  title: "208 示範導覽",
  scenes: [
    {
      sceneId: "a-field",
      name: "A 操場",
      intro: "第一站：操場。請找找看紅色圓圈 TARGET 在哪個方位？",
      panoramaUrl: "/classroom/scenes/a-field.jpg",
      thumbUrl: "/classroom/scenes/a-field.thumb.jpg",
      initialYaw: 0,
      initialPitch: 0,
      infoHotspots: [{ id: "a1", yaw: -90, pitch: 5, title: "西邊", text: "這是西邊（W）。" }],
      credit: "測試圖：程式產生",
    },
    {
      sceneId: "b-library",
      name: "B 圖書館",
      intro: "第二站：圖書館。書架上有幾種顏色的書？",
      panoramaUrl: "/classroom/scenes/b-library.jpg",
      thumbUrl: "/classroom/scenes/b-library.thumb.jpg",
      initialYaw: 0,
      initialPitch: 0,
      infoHotspots: [],
      credit: "測試圖：程式產生",
    },
    {
      sceneId: "c-studio",
      name: "C 美術教室",
      intro: "第三站：美術教室。牆上的色塊讓你想到哪位藝術家？",
      panoramaUrl: "/classroom/scenes/c-studio.jpg",
      thumbUrl: "/classroom/scenes/c-studio.thumb.jpg",
      initialYaw: 0,
      initialPitch: 0,
      infoHotspots: [],
      credit: "測試圖：程式產生",
    },
  ],
};
