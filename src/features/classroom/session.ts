"use client";
/** 分頁層級的工作階段資訊（sessionStorage：重新整理保留，關掉分頁就清掉） */

export interface StudentSession {
  roomId: string;
  userId: string;
  displayName: string;
}
export interface TeacherRoomSession {
  roomId: string;
  joinCode: string;
}

function read<T>(k: string): T | null {
  try {
    const s = sessionStorage.getItem(k);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}
function write(k: string, v: unknown) {
  try {
    if (v === null) sessionStorage.removeItem(k);
    else sessionStorage.setItem(k, JSON.stringify(v));
  } catch {}
}

export const saveStudentSession = (s: StudentSession) => write("classroom-student", s);
export const loadStudentSession = () => read<StudentSession>("classroom-student");
export const saveTeacherRoom = (s: TeacherRoomSession | null) => write("classroom-teacher-room", s);
export const loadTeacherRoom = () => read<TeacherRoomSession>("classroom-teacher-room");
