import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import {
    Phone, PhoneCall, CheckCircle2, XCircle, Loader2, User,
    MapPin, Briefcase, CreditCard, Clock, IndianRupee, RefreshCw,
    ChevronDown, ChevronUp, PhoneForwarded, CalendarClock, UserCheck,
    X, Mic, Bot, Users, MessageSquare, Calendar, Sparkles
} from 'lucide-react';

const BACKEND_URL = '';

interface TranscriptMsg {
    role: 'user' | 'assistant';
    content: string;
}

interface LeadData {
    full_name?: string;
    phone?: string;
    city?: string;
    pincode?: string;
    product_interest?: string;
    loan_amount_range?: string;
    timeline?: string;
    employment_type?: string;
    monthly_income?: string;
    callback_time?: string;
    [key: string]: any;
}

interface SavedLead extends LeadData {
    id?: string;
    callSid?: string;
    timestamp?: string;
    status?: string;
    createdAt?: string;
}

interface Recording {
    id: string;
    callSid: string;
    conferenceSid?: string;
    duration: number;
    createdAt: string;
}

interface ScheduledCallback {
    id: string;
    callSid: string;
    customerPhone: string;
    customerName: string;
    scheduledTime: string;
    scheduledAt: string;
    status: string;
}

type AgentCallStatus = 'idle' | 'calling' | 'in-progress' | 'completed' | 'failed';
type RMCallStatus = 'idle' | 'dialing' | 'in-progress' | 'completed' | 'failed';

type NavSection = 'agent' | 'rm' | 'transcripts';

function App() {
    const [activeSection, setActiveSection] = useState<NavSection>('agent');
    const [phoneNumber, setPhoneNumber] = useState('+91 ');

    const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        const digits = val.replace(/^\+?9?1?\s*/, '').replace(/[^\d]/g, '').slice(0, 10);
        setPhoneNumber('+91 ' + digits);
    };
    const [activeCallSid, setActiveCallSid] = useState<string | null>(null);
    const [callStatus, setCallStatus] = useState<AgentCallStatus>('idle');
    const [rmCallStatus, setRMCallStatus] = useState<RMCallStatus>('idle');
    const [directRMStatus, setDirectRMStatus] = useState<'idle' | 'dialing' | 'live' | 'ended'>('idle');
    const [transcripts, setTranscripts] = useState<TranscriptMsg[]>([]);
    const [rmTranscripts, setRMTranscripts] = useState<TranscriptMsg[]>([]);
    const [liveData, setLiveData] = useState<LeadData>({});
    const [history, setHistory] = useState<SavedLead[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [expandedRow, setExpandedRow] = useState<string | null>(null);
    const [callbacks, setCallbacks] = useState<ScheduledCallback[]>([]);
    const [recordings, setRecordings] = useState<Recording[]>([]);
    const [isConnectingRM, setIsConnectingRM] = useState(false);
    const [toast, setToast] = useState<{ msg: string; type: 'error' | 'success' } | null>(null);
    const showToast = (msg: string, type: 'error' | 'success' = 'error') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 4000);
    };
    const [showScheduleModal, setShowScheduleModal] = useState(false);
    const [scheduleTime, setScheduleTime] = useState('');
    const [scheduleSubmitting, setScheduleSubmitting] = useState(false);
    const transcriptContainerRef = useRef<HTMLDivElement>(null);
    const rmTranscriptContainerRef = useRef<HTMLDivElement>(null);

    const fetchHistory = useCallback(async () => {
        setHistoryLoading(true);
        try {
            const res = await fetch(`${BACKEND_URL}/api/leads`);
            const data = await res.json();
            if (data.success) {
                setHistory([...(data.leads || [])].sort((a, b) =>
                    new Date(b.createdAt || b.timestamp || 0).getTime() -
                    new Date(a.createdAt || a.timestamp || 0).getTime()
                ));
            }
        } catch (err) {
            console.error('Failed to fetch history:', err);
        } finally {
            setHistoryLoading(false);
        }
    }, []);

    const fetchCallbacks = useCallback(async () => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/callbacks`);
            const data = await res.json();
            if (data.success) setCallbacks(data.callbacks || []);
        } catch (err) {
            console.error('Failed to fetch callbacks:', err);
        }
    }, []);

    const fetchRecordings = useCallback(async () => {
        try {
            const res = await fetch(`${BACKEND_URL}/api/recordings`);
            const data = await res.json();
            if (data.success) setRecordings(data.recordings || []);
        } catch (err) {
            console.error('Failed to fetch recordings:', err);
        }
    }, []);

    useEffect(() => {
        fetchHistory();
        fetchCallbacks();
        fetchRecordings();

        const socket = io(BACKEND_URL);

        socket.on('transcription_update', (data: { callSid: string; role: 'user' | 'assistant'; content: string }) => {
            setTranscripts(prev => [...prev, { role: data.role, content: data.content }]);
        });

        socket.on('call_status_update', (data: { callSid: string; status: string; leadData?: LeadData }) => {
            const s = data.status as AgentCallStatus;
            if (data.callSid) setActiveCallSid(data.callSid);
            if (['in-progress', 'completed', 'failed'].includes(s)) {
                setCallStatus(s);
                if (s === 'failed') setTimeout(() => setCallStatus('idle'), 5000);
            }
            if (data.leadData) setLiveData(prev => ({ ...prev, ...data.leadData }));
            if (s === 'completed') {
                fetchHistory();
                setRMCallStatus('idle');
            }
        });

        socket.on('rm_call_status', (data: { callSid: string; status: string }) => {
            const s = data.status as RMCallStatus;
            setRMCallStatus(s);
            setIsConnectingRM(false);
            if (s === 'failed') setTimeout(() => setRMCallStatus('idle'), 5000);
        });

        socket.on('rm_transcription_update', (data: { callSid: string; role: string; content: string }) => {
            setRMTranscripts(prev => [...prev, { role: data.role as any, content: data.content }]);
        });

        socket.on('callback_scheduled', (data: ScheduledCallback) => {
            setCallbacks(prev => [data, ...prev]);
        });

        socket.on('recording_ready', (data: Recording) => {
            setRecordings(prev => [data, ...prev.filter(r => r.id !== data.id)]);
        });

        return () => {
            socket.off('call_status_update');
            socket.off('transcription_update');
            socket.off('extracted_data_update');
            socket.off('rm_status_update');
            socket.off('rm_transcription_update');
            socket.off('callback_scheduled');
            socket.off('recording_ready');
        };
    }, []);

    const handleCall = async () => {
        if (!phoneNumber) return;
        setCallStatus('calling');
        setTranscripts([]);
        setLiveData({});
        try {
            const res = await fetch(`${BACKEND_URL}/api/call/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: phoneNumber })
            });
            const data = await res.json();
            if (data.success) {
                setActiveCallSid(data.callSid);
            } else {
                setCallStatus('failed');
                showToast('Please enter a valid phone number.');
                setTimeout(() => setCallStatus('idle'), 5000);
            }
        } catch { 
            setCallStatus('failed'); 
            showToast('Cannot reach backend'); 
            setTimeout(() => setCallStatus('idle'), 5000);
        }
    };

    const handleDirectRMCall = async () => {
        if (!phoneNumber) { showToast('Enter a phone number first'); return; }
        setDirectRMStatus('dialing');
        setCallStatus('idle');
        setTranscripts([]);
        setRMTranscripts([]);
        setLiveData({});
        try {
            const res = await fetch(`${BACKEND_URL}/api/rm/direct-call`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: phoneNumber })
            });
            const data = await res.json();
            if (data.success) {
                setActiveCallSid(data.customerCallSid);
                setDirectRMStatus('live');
                setRMCallStatus('dialing');
                showToast('Calling customer & RM — connecting to conference!', 'success');
            } else {
                setDirectRMStatus('ended');
                showToast('Please enter a valid phone number.');
                setTimeout(() => setDirectRMStatus('idle'), 5000);
            }
        } catch {
            setDirectRMStatus('ended');
            showToast('Cannot reach backend — is the server running?');
            setTimeout(() => setDirectRMStatus('idle'), 5000);
        }
    };

    const handleScheduleSubmit = async () => {
        if (!scheduleTime.trim()) return;
        setScheduleSubmitting(true);
        try {
            await fetch(`${BACKEND_URL}/api/callbacks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    callSid: activeCallSid || 'manual',
                    customerPhone: phoneNumber,
                    customerName: liveData.full_name || 'Customer',
                    scheduledTime: scheduleTime,
                })
            });
            setShowScheduleModal(false);
            setScheduleTime('');
            fetchCallbacks();
        } catch (err) {
            console.error('Failed to schedule callback:', err);
        } finally {
            setScheduleSubmitting(false);
        }
    };

    const agentStatusCfg: Record<AgentCallStatus, any> = {
        idle: { cls: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30', label: 'Not Connected', icon: null },
        dialing: { cls: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30', label: 'Dialing Agent...', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
        'in-progress': { cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', label: 'Agent Live', icon: <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> },
        completed: { cls: 'bg-green-500/20 text-green-300 border-green-500/30', label: 'Call Ended', icon: <CheckCircle2 className="w-3 h-3" /> },
        failed: { cls: 'bg-red-500/20 text-red-300 border-red-500/30', label: 'Call Failed', icon: <XCircle className="w-3 h-3" /> },
    };

    const rmStatusCfg: Record<RMCallStatus, any> = {
        idle: { cls: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30', label: 'Not Connected', icon: null },
        dialing: { cls: 'bg-purple-500/20 text-purple-300 border-purple-500/30', label: 'Dialing RM...', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
        'in-progress': { cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', label: 'RM Live', icon: <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> },
        completed: { cls: 'bg-green-500/20 text-green-300 border-green-500/30', label: 'RM Call Ended', icon: <CheckCircle2 className="w-3 h-3" /> },
        failed: { cls: 'bg-red-500/20 text-red-300 border-red-500/30', label: 'RM Failed', icon: <XCircle className="w-3 h-3" /> },
    };

    const agentCfg = agentStatusCfg[callStatus] || { cls: '', label: '', icon: null };
    const rmCfg = rmStatusCfg[rmCallStatus] || { cls: '', label: '', icon: null };

    return (
        <div className="relative min-h-screen w-full flex flex-col">
            {/* Background Orbs */}
            <div className="orb-1"></div>
            <div className="orb-2"></div>

            {/* Top Glass Navigation */}
            <header className="absolute top-4 left-1/2 -translate-x-1/2 z-50">
                <nav className="glass-panel px-2 py-2 flex items-center gap-2">
                    <button onClick={() => setActiveSection('agent')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${activeSection === 'agent' ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-white'}`}>Agent Dashboard</button>
                    <button onClick={() => setActiveSection('rm')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${activeSection === 'rm' ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-white'}`}>RM Console</button>
                    <button onClick={() => setActiveSection('transcripts')} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${activeSection === 'transcripts' ? 'bg-white/10 text-white' : 'text-zinc-400 hover:text-white'}`}>Transcripts</button>
                </nav>
            </header>

            {/* ── Toast ── */}
            {toast && (
                <div className={`fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-4 py-2.5 rounded-lg border shadow-2xl text-xs font-medium ${
                    toast.type === 'success' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-red-500/20 text-red-300 border-red-500/30'
                } backdrop-blur-xl`}>
                    {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    {toast.msg}
                </div>
            )}

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col items-center justify-start pt-28 px-4 pb-10 overflow-y-auto w-full relative z-10">
                {activeSection === 'agent' ? (
                    <div className="w-full max-w-5xl flex flex-col items-center gap-12">
                        {/* THE SPOTLIGHT SEARCH DIALER */}
                        <div className="w-full max-w-2xl relative group mt-10">
                            <div className="spotlight-bar flex items-center p-2 relative z-20">
                                <div className="pl-6 pr-4 flex-1 flex items-center gap-4">
                                    <Phone className="w-5 h-5 text-indigo-400" />
                                    <input 
                                        type="tel"
                                        placeholder="Enter phone number to initiate AI call..."
                                        className="spotlight-input text-lg"
                                        value={phoneNumber}
                                        onChange={handlePhoneChange}
                                        onKeyDown={(e) => e.key === 'Enter' && handleCall()}
                                    />
                                </div>
                                <button 
                                    onClick={handleCall}
                                    disabled={callStatus === 'in-progress' || callStatus === 'dialing' || phoneNumber.length !== 14}
                                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-full font-semibold transition-all shadow-lg hover:shadow-indigo-500/50 disabled:opacity-50 flex items-center gap-2"
                                >
                                    {callStatus === 'dialing' ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Call Now'}
                                </button>
                            </div>
                            {/* Audio Pulse Visualizer when Live */}
                            {callStatus === 'in-progress' && (
                                <div className="absolute -bottom-16 left-1/2 -translate-x-1/2 flex gap-1 items-center">
                                    {[...Array(12)].map((_, i) => (
                                        <div key={i} className="audio-bar" style={{ animationDelay: `${i * 0.1}s` }}></div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Status Badges */}
                        <div className="flex gap-4 items-center mt-8">
                            <StatusBadge label="Agent Status" config={agentCfg} />
                            <StatusBadge label="Extraction" config={{ label: liveData.full_name ? 'Data Found' : 'Listening...', cls: liveData.full_name ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30', icon: null }} />
                        </div>

                        {/* Bento Box Data Grid */}
                        <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-6">
                            {/* Call Details */}
                            <div className="glass-panel p-6 flex flex-col gap-4">
                                <h3 className="text-sm font-semibold text-white flex items-center gap-2"><User className="w-4 h-4 text-indigo-400"/> Lead Info</h3>
                                <div className="space-y-3">
                                    <BentoItem label="Name" value={liveData.full_name} />
                                    <BentoItem label="Phone" value={liveData.phone_number} mono={true} />
                                </div>
                            </div>
                            
                            {/* Extracted Details */}
                            <div className="glass-panel p-6 flex flex-col gap-4 col-span-2">
                                <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Sparkles className="w-4 h-4 text-purple-400"/> Live Extracted Data</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <BentoItem label="Interest Level" value={liveData.interest_level} highlight={true} />
                                    <BentoItem label="Income Range" value={liveData.income_range} />
                                    <BentoItem label="Preferred Product" value={liveData.preferred_product} highlight={true} />
                                    <BentoItem label="Objections" value={liveData.objections} />
                                </div>
                            </div>
                        </div>

                        {/* History Table */}
                        <div className="w-full glass-panel p-6">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Clock className="w-4 h-4 text-indigo-400"/> Recent Calls</h3>
                                <button onClick={fetchHistory} className="text-zinc-400 hover:text-white transition-colors"><RefreshCw className="w-4 h-4"/></button>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left whitespace-nowrap">
                                    <thead>
                                        <tr className="text-[10px] uppercase tracking-wider text-zinc-500 border-b border-white/10">
                                            <th className="pb-3 px-4 font-semibold">Phone</th>
                                            <th className="pb-3 px-4 font-semibold">Status</th>
                                            <th className="pb-3 px-4 font-semibold">Interest</th>
                                            <th className="pb-3 px-4 font-semibold text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="text-sm text-zinc-300 divide-y divide-white/5">
                                        {history.map(row => (
                                            <tr key={row.id} className="hover:bg-white/[0.02] transition-colors">
                                                <td className="py-3 px-4 font-mono text-zinc-400">{row.phone_number}</td>
                                                <td className="py-3 px-4">
                                                    <span className={`px-2 py-1 rounded text-xs font-medium border ${row.status === 'completed' ? 'border-green-500/30 text-green-400 bg-green-500/10' : row.status === 'failed' ? 'border-red-500/30 text-red-400 bg-red-500/10' : 'border-indigo-500/30 text-indigo-400 bg-indigo-500/10'}`}>
                                                        {row.status}
                                                    </span>
                                                </td>
                                                <td className="py-3 px-4 text-purple-300 font-medium">{row.interest_level || '--'}</td>
                                                <td className="py-3 px-4 text-right">
                                                    <button onClick={() => { setLiveSessionId(row.session_id); setActiveSection('transcripts'); }} className="text-xs text-indigo-400 hover:text-indigo-300 font-medium">View Transcript</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                ) : activeSection === 'rm' ? (
                    <div className="w-full max-w-5xl flex flex-col items-center gap-12 mt-10">
                        {/* RM Spotlight Dialer */}
                        <div className="w-full max-w-2xl relative group">
                            <div className="spotlight-bar flex items-center p-2">
                                <div className="pl-6 pr-4 flex-1 flex items-center gap-4">
                                    <PhoneForwarded className="w-5 h-5 text-purple-400" />
                                    <input 
                                        type="tel"
                                        placeholder="Direct RM Dial (Bypass AI)..."
                                        className="spotlight-input text-lg"
                                        value={phoneNumber}
                                        onChange={handlePhoneChange}
                                        onKeyDown={(e) => e.key === 'Enter' && handleDirectRMCall()}
                                    />
                                </div>
                                <button 
                                    onClick={handleDirectRMCall}
                                    disabled={callStatus === 'in-progress' || directRMStatus === 'dialing' || phoneNumber.length !== 14}
                                    className="bg-purple-600 hover:bg-purple-500 text-white px-8 py-3 rounded-full font-semibold transition-all shadow-lg hover:shadow-purple-500/50 disabled:opacity-50 flex items-center gap-2"
                                >
                                    {directRMStatus === 'dialing' ? <Loader2 className="w-5 h-5 animate-spin" /> : 'RM Call'}
                                </button>
                            </div>
                        </div>

                        {/* AI Handoff Cheat Sheet & Dispositions */}
                        <div className="w-full max-w-5xl flex flex-col gap-6">
                            {/* Handoff Summary */}
                            <div className="glass-panel p-6">
                                <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-4"><Sparkles className="w-4 h-4 text-purple-400"/> AI Handoff Summary</h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div className="bento-card border-purple-500/20 bg-purple-500/5">
                                        <p className="text-xs text-purple-300 font-medium mb-1">Customer Sentiment</p>
                                        <p className="text-lg font-bold text-white">{liveData.interest_level || 'Unknown'}</p>
                                    </div>
                                    <div className="bento-card border-indigo-500/20 bg-indigo-500/5">
                                        <p className="text-xs text-indigo-300 font-medium mb-1">Target Product</p>
                                        <p className="text-lg font-bold text-white">{liveData.preferred_product || 'Not Identified'}</p>
                                    </div>
                                    <div className="bento-card border-rose-500/20 bg-rose-500/5">
                                        <p className="text-xs text-rose-300 font-medium mb-1">Key Objection</p>
                                        <p className="text-lg font-bold text-white">{liveData.objection || 'None recorded'}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Dispositions */}
                            <div className="flex items-center justify-center gap-3">
                                <span className="text-xs text-zinc-500 font-medium mr-2">Log Call Outcome:</span>
                                <button className="px-5 py-2 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 text-sm font-bold hover:bg-green-500/20 hover:scale-105 transition-all shadow-lg shadow-green-500/10">🔥 Hot Lead</button>
                                <button className="px-5 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm font-bold hover:bg-yellow-500/20 hover:scale-105 transition-all shadow-lg shadow-yellow-500/10">⏳ Follow-up</button>
                                <button className="px-5 py-2 rounded-xl bg-zinc-500/10 border border-zinc-500/30 text-zinc-400 text-sm font-bold hover:bg-zinc-500/20 hover:scale-105 transition-all">❌ Not Interested</button>
                            </div>
                        </div>

                        {/* RM Grid */}
                        <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Callbacks */}
                            <div className="glass-panel p-6 flex flex-col">
                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Calendar className="w-4 h-4 text-purple-400"/> Scheduled Callbacks</h3>
                                    <button onClick={fetchCallbacks} className="text-zinc-400 hover:text-white"><RefreshCw className="w-4 h-4"/></button>
                                </div>
                                <div className="relative border-l-2 border-white/10 ml-3 space-y-6">
                                    {callbacks.map(cb => (
                                        <div key={cb.id} className="relative pl-6">
                                            <div className="absolute w-3.5 h-3.5 bg-purple-500/50 border-[3px] border-[#030305] rounded-full -left-[9px] top-1.5 ring-2 ring-purple-500/30"></div>
                                            <div className="bento-card p-4 hover:border-purple-500/30 transition-colors group">
                                                <div className="flex justify-between items-start">
                                                    <div>
                                                        <h4 className="text-sm font-bold text-white">{cb.customerName}</h4>
                                                        <p className="text-xs font-mono text-zinc-500 mt-1">{cb.customerPhone}</p>
                                                    </div>
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${cb.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' : 'bg-green-500/20 text-green-400 border border-green-500/30'}`}>{cb.status}</span>
                                                </div>
                                                <div className="mt-4 flex items-center justify-between">
                                                    <p className="text-xs text-purple-300 font-semibold bg-purple-500/10 px-2 py-1.5 rounded-md inline-flex items-center gap-1.5"><Clock className="w-3 h-3"/> {cb.scheduledTime}</p>
                                                    <button 
                                                        onClick={() => { setPhoneNumber(cb.customerPhone); handleDirectRMCall(); }}
                                                        className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-all opacity-0 group-hover:opacity-100 shadow-lg"
                                                    >
                                                        <PhoneForwarded className="w-3 h-3" /> Quick Dial
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Recordings */}
                            <div className="glass-panel p-6 flex flex-col">
                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Mic className="w-4 h-4 text-purple-400"/> Call Recordings</h3>
                                    <button onClick={fetchRecordings} className="text-zinc-400 hover:text-white"><RefreshCw className="w-4 h-4"/></button>
                                </div>
                                <div className="space-y-4">
                                    {recordings.map(rec => (
                                        <div key={rec.id} className="bento-card group hover:border-purple-500/20 transition-all">
                                            <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/5">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-400">
                                                        <Mic className="w-4 h-4" />
                                                    </div>
                                                    <div>
                                                        <p className="text-xs font-bold text-white">{new Date(rec.createdAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                                                        <p className="text-[10px] font-mono text-zinc-500 mt-0.5">ID: {rec.id.slice(0,8)}</p>
                                                    </div>
                                                </div>
                                            </div>
                                            <audio controls src={`${BACKEND_URL}/api/recordings/${rec.id}/audio`} className="w-full h-10 rounded-full opacity-90 invert grayscale contrast-125 sepia hover:opacity-100 transition-opacity" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="w-full max-w-5xl h-full flex flex-col gap-6 mt-6">
                        {/* Transcripts view */}
                        <div className="glass-panel flex-1 flex flex-col md:flex-row overflow-hidden min-h-[600px]">
                            {/* Agent side */}
                            <div className="flex-1 flex flex-col border-b md:border-b-0 md:border-r border-white/10">
                                <div className="p-4 border-b border-white/10 flex items-center gap-3 bg-white/[0.02]">
                                    <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                                        <Bot className="w-4 h-4 text-indigo-400"/>
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-semibold text-white">AI Agent Stream</h3>
                                        <p className="text-[10px] text-zinc-500 font-mono">live-transcript.log</p>
                                    </div>
                                </div>
                                <div className="flex-1 overflow-y-auto p-6 space-y-4" ref={transcriptContainerRef}>
                                    {transcripts.map((t, i) => (
                                        <div key={i} className={`p-4 rounded-2xl max-w-[85%] ${t.role === 'agent' ? 'bg-indigo-500/10 border border-indigo-500/20 ml-auto rounded-tr-sm' : 'bg-white/5 border border-white/10 rounded-tl-sm'}`}>
                                            <p className="text-xs font-semibold text-zinc-400 mb-1">{t.role === 'agent' ? 'Finfinity AI' : 'Customer'}</p>
                                            <p className="text-sm text-zinc-200 leading-relaxed">{t.content}</p>
                                        </div>
                                    ))}
                                    {callStatus === 'in-progress' && (
                                        <div className="flex items-center gap-2 text-indigo-400 ml-auto w-fit p-4">
                                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
                                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: '0.2s' }}></span>
                                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" style={{ animationDelay: '0.4s' }}></span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* RM side */}
                            <div className="flex-1 flex flex-col bg-black/20">
                                <div className="p-4 border-b border-white/10 flex items-center gap-3 bg-white/[0.02]">
                                    <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center border border-purple-500/30">
                                        <Users className="w-4 h-4 text-purple-400"/>
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-semibold text-white">Human RM Stream</h3>
                                        <p className="text-[10px] text-zinc-500 font-mono">rm-override.log</p>
                                    </div>
                                    {rmCallStatus === 'in-progress' && (
                                        <button onClick={() => setShowScheduleModal(true)} className="ml-auto bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 px-3 py-1.5 rounded-lg text-xs font-semibold border border-purple-500/30 transition-colors">
                                            Schedule Callback
                                        </button>
                                    )}
                                </div>
                                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                                    {rmTranscripts.map((t, i) => (
                                        <div key={i} className={`p-4 rounded-2xl max-w-[85%] ${t.role === 'rm' ? 'bg-purple-500/10 border border-purple-500/20 ml-auto rounded-tr-sm' : 'bg-white/5 border border-white/10 rounded-tl-sm'}`}>
                                            <p className="text-xs font-semibold text-zinc-400 mb-1">{t.role === 'rm' ? 'Human RM' : 'Customer'}</p>
                                            <p className="text-sm text-zinc-200 leading-relaxed">{t.content}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </main>

            {/* Schedule Callback Modal */}
            {showScheduleModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
                    <div className="glass-panel p-6 w-full max-w-sm">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-semibold text-white">Schedule Callback</h3>
                            <button onClick={() => setShowScheduleModal(false)} className="text-zinc-400 hover:text-white"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="space-y-4 mb-6">
                            <input
                                type="text"
                                placeholder='e.g. "tomorrow at 3pm"'
                                value={scheduleTime}
                                onChange={e => setScheduleTime(e.target.value)}
                                className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 placeholder-zinc-600"
                                autoFocus
                            />
                            <p className="text-xs text-zinc-400">Scheduling for: <span className="text-zinc-200 font-medium">{liveData.full_name || phoneNumber}</span></p>
                        </div>
                        <div className="flex gap-3">
                            <button onClick={() => setShowScheduleModal(false)} className="flex-1 border border-white/10 text-zinc-300 hover:text-white hover:bg-white/5 py-2.5 rounded-xl text-sm font-medium transition-colors">Cancel</button>
                            <button onClick={handleScheduleSubmit} disabled={!scheduleTime.trim() || scheduleSubmitting} className="flex-1 bg-purple-600 hover:bg-purple-500 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition-colors shadow-lg shadow-purple-500/25">
                                {scheduleSubmitting && <Loader2 className="w-4 h-4 animate-spin" />} Confirm
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Helper Components
function StatusBadge({ label, config }: { label: string, config: any }) {
    return (
        <div className={`px-4 py-2 rounded-full border border-white/5 flex items-center gap-2 ${config.cls} backdrop-blur-md`}>
            {config.icon}
            <span className="text-xs font-semibold tracking-wide uppercase">{label}: {config.label}</span>
        </div>
    );
}

function BentoItem({ label, value, highlight, mono }: { label: string; value?: string; highlight?: boolean; mono?: boolean }) {
    return (
        <div className="bento-card">
            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-1">{label}</p>
            <p className={`text-sm truncate ${highlight && value ? 'text-indigo-300 font-medium' : 'text-zinc-200'} ${mono ? 'font-mono' : ''}`}>
                {value || <span className="text-zinc-600 italic font-normal">Waiting...</span>}
            </p>
        </div>
    );
}

export default App;

