'use client';
import { useEffect, useState } from 'react';
import { authFetch } from '../auth-fetch';
import { Panel } from '../ui';
const API=process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000/api/v1';
const PORTAL=process.env.NEXT_PUBLIC_EMPLOYEE_PORTAL_URL??'http://localhost:3003';
export default function EmployeeSelfLanding({token}:{token:string}){
  const [profile,setProfile]=useState<{fullName:string;employeeNumber:string}|null>(null);const [message,setMessage]=useState('Memuat profil pribadi…');
  useEffect(()=>{let active=true;void authFetch(`${API}/employee/me`,token).then(async response=>{if(!response.ok)throw new Error(response.status===404?'Akun belum terhubung ke data karyawan. Hubungi HR.':'Profil pribadi belum dapat dimuat.');return response.json();}).then(data=>{if(active){setProfile(data);setMessage('');}}).catch(error=>{if(active)setMessage(error.message);});return()=>{active=false;};},[token]);
  return <Panel eyebrow="LAYANAN PRIBADI" title="Portal Karyawan"><div data-employee-self-landing>{profile&&<p>{profile.fullName} · {profile.employeeNumber}</p>}{message&&<p role="status">{message}</p>}<p>Absensi, koreksi, cuti, lembur dan slip gaji pribadi tersedia melalui Portal Karyawan. Akses data payroll dan personalia cabang mengikuti kewenangan pengelola.</p><a className="primaryButton" href={PORTAL}>Buka Portal Karyawan</a></div></Panel>;
}
