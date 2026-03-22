import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import {
    Phone, PhoneCall, CheckCircle2, XCircle, Loader2, User,
    MapPin, Briefcase, CreditCard, Clock, IndianRupee, RefreshCw,
    ChevronDown, ChevronUp, PhoneForwarded, CalendarClock, UserCheck,
    X, Mic, Bot, Users, MessageSquare
} from 'lucide-react';

const BACKEND_URL = 'http://localhost:3000';

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
    const [phoneNumber, setPhoneNumber] = useState('');
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
            if (['in-progress', 'completed', 'failed'].includes(s)) setCallStatus(s);
            if (data.leadData) setLiveData(prev => ({ ...prev, ...data.leadData }));
            if (s === 'completed') {
                fetchHistory();
                setRMCallStatus('idle');
            }
        });

        socket.on('rm_call_status', (data: { callSid: string; status: string }) => {
            setRMCallStatus(data.status as RMCallStatus);
            setIsConnectingRM(false);
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

        return () => { socket.close(); };
    }, [fetchHistory, fetchCallbacks, fetchRecordings]);

    useEffect(() => {
        const el = transcriptContainerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [transcripts]);

    useEffect(() => {
        const el = rmTranscriptContainerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [rmTranscripts]);

    const handleCall = async () => {
        if (!phoneNumber) return;
        setCallStatus('calling');
        setRMCallStatus('idle');
        setDirectRMStatus('idle');
        setTranscripts([]);
        setRMTranscripts([]);
        setLiveData({});
        setIsConnectingRM(false);
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
                alert('Call failed: ' + data.error);
            }
        } catch { setCallStatus('failed'); }
    };

    const handleDirectRMCall = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!phoneNumber) {
            showToast('Enter a phone number first');
            return;
        }
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
                showToast('Direct call failed: ' + data.error);
            }
        } catch (err: any) {
            setDirectRMStatus('ended');
            showToast('Cannot reach backend — is the server running?');
        }
    };

    const handleConnectRMNow = async () => {
        if (!activeCallSid) return;
        setIsConnectingRM(true);
        setRMCallStatus('dialing');
        setTimeout(() => {
            if (rmCallStatus === 'dialing') setIsConnectingRM(false);
        }, 15000);
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

    const agentStatusCfg: Record<AgentCallStatus, { cls: string; label: string; icon: React.ReactNode }> = {
        idle: { cls: 'bg-gray-500/30 text-gray-200', label: 'Idle', icon: null },
        calling: { cls: 'bg-blue-500/30 text-blue-200', label: 'Dialing...', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
        'in-progress': { cls: 'bg-yellow-500/30 text-yellow-200', label: 'Live Call', icon: <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" /> },
        completed: { cls: 'bg-green-500/30 text-green-200', label: 'Saved', icon: <CheckCircle2 className="w-3 h-3" /> },
        failed: { cls: 'bg-red-500/30 text-red-200', label: 'Failed', icon: <XCircle className="w-3 h-3" /> },
    };

    const rmStatusCfg: Record<RMCallStatus, { cls: string; label: string; icon: React.ReactNode }> = {
        idle: { cls: 'bg-gray-500/30 text-gray-300', label: 'Not Connected', icon: null },
        dialing: { cls: 'bg-indigo-500/30 text-indigo-200', label: 'Dialing RM...', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
        'in-progress': { cls: 'bg-emerald-500/30 text-emerald-200', label: 'RM Live', icon: <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> },
        completed: { cls: 'bg-green-500/30 text-green-200', label: 'RM Call Ended', icon: <CheckCircle2 className="w-3 h-3" /> },
        failed: { cls: 'bg-red-500/30 text-red-200', label: 'RM Failed', icon: <XCircle className="w-3 h-3" /> },
    };

    const agentCfg = agentStatusCfg[callStatus];
    const rmCfg = rmStatusCfg[rmCallStatus];

    return (
        <div className="min-h-screen flex flex-col">
            {/* ── Navbar ── */}
            <nav className="glass border-b border-white/10 sticky top-0 z-40">
                <div className="max-w-7xl mx-auto px-4 md:px-8">
                    <div className="flex items-center justify-between h-16">
                        <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
                            Finfinity Live Dashboard
                        </h1>
                        <div className="flex items-center gap-1 p-1 rounded-xl bg-white/5 border border-white/10">
                            <button
                                onClick={() => setActiveSection('agent')}
                                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-all ${
                                    activeSection === 'agent'
                                        ? 'bg-emerald-500/30 text-emerald-200 border border-emerald-500/40 shadow-sm'
                                        : 'text-indigo-300 hover:text-white hover:bg-white/5'
                                }`}
                            >
                                <Bot className="w-4 h-4" /> AI Agent
                                <span className={`px-2 py-0.5 rounded-full text-xs ${agentCfg.cls}`}>
                                    {agentCfg.icon}{agentCfg.label}
                                </span>
                            </button>
                            <button
                                onClick={() => setActiveSection('rm')}
                                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-all ${
                                    activeSection === 'rm'
                                        ? 'bg-violet-500/30 text-violet-200 border border-violet-500/40 shadow-sm'
                                        : 'text-indigo-300 hover:text-white hover:bg-white/5'
                                }`}
                            >
                                <Users className="w-4 h-4" /> RM
                                <span className={`px-2 py-0.5 rounded-full text-xs ${rmCfg.cls}`}>
                                    {rmCfg.icon}{rmCfg.label}
                                </span>
                            </button>
                            <button
                                onClick={() => setActiveSection('transcripts')}
                                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-all ${
                                    activeSection === 'transcripts'
                                        ? 'bg-amber-500/30 text-amber-200 border border-amber-500/40 shadow-sm'
                                        : 'text-indigo-300 hover:text-white hover:bg-white/5'
                                }`}
                            >
                                <MessageSquare className="w-4 h-4" /> Live Transcription
                            </button>
                        </div>
                    </div>
                </div>
            </nav>

            {/* ── Toast ── */}
            {toast && (
                <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl text-sm font-medium ${
                    toast.type === 'success' ? 'bg-emerald-500/90 text-white' : 'bg-red-500/90 text-white'
                }`}>
                    {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                    {toast.msg}
                </div>
            )}

            {/* ── Main Content ── */}
            <main className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full space-y-8">
                {activeSection === 'transcripts' ? (
                    /* Live Transcription page */
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="glass rounded-2xl p-6 flex flex-col h-[560px]">
                            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 pb-3 border-b border-white/10">
                                <span className="relative flex h-3 w-3">
                                    {(callStatus === 'in-progress' || callStatus === 'calling') && (
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                    )}
                                    <span className={`relative inline-flex rounded-full h-3 w-3 ${callStatus === 'in-progress' || callStatus === 'calling' ? 'bg-emerald-500' : 'bg-gray-500'}`} />
                                </span>
                                <Phone className="w-4 h-4 text-emerald-400" />
                                AI Agent Call
                            </h2>
                            <div ref={transcriptContainerRef} className="flex-1 overflow-y-auto space-y-3 pr-1">
                                {transcripts.length === 0 ? (
                                    <div className="h-full flex items-center justify-center text-indigo-200/40 italic text-sm text-center">
                                        Waiting for agent call to start...
                                    </div>
                                ) : (
                                    transcripts.map((msg, idx) => (
                                        <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${msg.role === 'user'
                                                ? 'bg-emerald-500/20 text-emerald-100 border border-emerald-500/30 rounded-br-none'
                                                : 'bg-white/10 text-indigo-50 border border-white/10 rounded-bl-none'
                                            }`}>
                                                <p className="text-xs uppercase tracking-wider font-semibold opacity-50 mb-1">
                                                    {msg.role === 'user' ? 'Customer' : 'AI Agent'}
                                                </p>
                                                <p className="leading-relaxed text-sm">{msg.content}</p>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                        <div className={`glass rounded-2xl p-6 flex flex-col h-[560px] transition-all duration-500 ${rmCallStatus !== 'idle' ? 'ring-2 ring-violet-500/40' : ''}`}>
                            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 pb-3 border-b border-white/10">
                                <span className="relative flex h-3 w-3">
                                    {rmCallStatus === 'in-progress' && (
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                                    )}
                                    <span className={`relative inline-flex rounded-full h-3 w-3 ${rmCallStatus === 'in-progress' ? 'bg-violet-500' : rmCallStatus === 'dialing' ? 'bg-indigo-400 animate-pulse' : 'bg-gray-500'}`} />
                                </span>
                                <UserCheck className="w-4 h-4 text-violet-400" />
                                RM Call
                                <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${rmStatusCfg[rmCallStatus].cls}`}>
                                    {rmStatusCfg[rmCallStatus].label}
                                </span>
                            </h2>
                            {rmCallStatus === 'idle' ? (
                                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
                                    <div className="w-14 h-14 rounded-full bg-violet-500/10 flex items-center justify-center">
                                        <PhoneForwarded className="w-7 h-7 text-violet-400/50" />
                                    </div>
                                    <p className="text-indigo-300/50 italic text-sm">
                                        RM call panel will activate when a customer requests to speak with a relationship manager.
                                    </p>
                                </div>
                            ) : rmCallStatus === 'dialing' ? (
                                <div className="flex-1 flex flex-col items-center justify-center gap-4">
                                    <div className="relative">
                                        <div className="w-16 h-16 rounded-full bg-indigo-500/20 animate-ping absolute top-0 left-0" />
                                        <div className="w-16 h-16 rounded-full bg-indigo-600/30 flex items-center justify-center relative">
                                            <Phone className="w-8 h-8 text-indigo-300 animate-bounce" />
                                        </div>
                                    </div>
                                    <p className="text-indigo-200 font-medium">Dialing Relationship Manager...</p>
                                    <p className="text-indigo-300/60 text-sm">+91 93723 63285</p>
                                </div>
                            ) : (
                                <div ref={rmTranscriptContainerRef} className="flex-1 overflow-y-auto space-y-3 pr-1">
                                    {rmTranscripts.length === 0 ? (
                                        <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-4">
                                            {rmCallStatus === 'in-progress' ? (
                                                <>
                                                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                                    <p className="text-indigo-200/60 italic text-sm">RM connected — transcription processing...</p>
                                                    <p className="text-indigo-300/40 text-xs">Text appears in ~8s chunks via Groq Whisper</p>
                                                </>
                                            ) : (
                                                <p className="text-indigo-200/40 italic text-sm">RM call transcript will appear here.</p>
                                            )}
                                        </div>
                                    ) : (
                                        rmTranscripts.map((msg, idx) => (
                                            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${msg.role === 'user'
                                                    ? 'bg-violet-500/20 text-violet-100 border border-violet-500/30 rounded-br-none'
                                                    : 'bg-white/10 text-indigo-50 border border-white/10 rounded-bl-none'
                                                }`}>
                                                    <p className="text-xs uppercase tracking-wider font-semibold opacity-50 mb-1">
                                                        {msg.role === 'user' ? 'Customer' : 'RM'}
                                                    </p>
                                                    <p className="leading-relaxed text-sm">{msg.content}</p>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                ) : activeSection === 'agent' ? (
                    <>
                        {/* Agent: Big Make Call (centered) */}
                        <div className="flex justify-center">
                            <div className="glass rounded-2xl p-8 md:p-12 w-full max-w-2xl flex flex-col gap-6">
                                <h2 className="text-2xl font-semibold text-center flex items-center justify-center gap-3">
                                    <PhoneCall className="w-8 h-8 text-emerald-400" /> Make a Call
                                </h2>
                                <input
                                    type="tel"
                                    placeholder="+91 9876543210"
                                    value={phoneNumber}
                                    onChange={e => setPhoneNumber(e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-lg text-white placeholder-indigo-300/50 focus:outline-none focus:ring-2 focus:ring-emerald-400/50"
                                />
                                <button
                                    onClick={handleCall}
                                    disabled={callStatus === 'calling' || callStatus === 'in-progress' || directRMStatus === 'dialing' || !phoneNumber}
                                    className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white font-bold py-4 px-6 rounded-2xl text-lg shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                                >
                                    <Phone className="w-6 h-6" /> Start Agent Call
                                </button>
                                {callStatus === 'in-progress' && (
                                    <div className="flex flex-col gap-3 pt-4 border-t border-white/10">
                                        <button
                                            onClick={handleConnectRMNow}
                                            disabled={isConnectingRM || rmCallStatus === 'in-progress' || rmCallStatus === 'dialing'}
                                            className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2"
                                        >
                                            {isConnectingRM || rmCallStatus === 'dialing' ? <Loader2 className="w-5 h-5 animate-spin" /> : <PhoneForwarded className="w-5 h-5" />}
                                            Connect RM Now
                                        </button>
                                        <button
                                            onClick={() => setShowScheduleModal(true)}
                                            className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-indigo-200 hover:text-white font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2"
                                        >
                                            <CalendarClock className="w-5 h-5" /> Schedule Callback
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Extracted Data */}
                        <div className="glass rounded-2xl p-6">
                            <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
                                <CheckCircle2 className="w-5 h-5 text-blue-400" /> Extracted Data
                            </h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                <DataRow icon={<User />} label="Name" value={liveData.full_name} />
                                <DataRow icon={<Phone />} label="Phone" value={liveData.phone} />
                                <DataRow icon={<MapPin />} label="Location" value={liveData.city ? `${liveData.city}${liveData.pincode ? ` (${liveData.pincode})` : ''}` : liveData.city} />
                                <DataRow icon={<Briefcase />} label="Employment" value={liveData.employment_type} />
                                <DataRow icon={<IndianRupee />} label="Income" value={liveData.monthly_income} />
                                <DataRow icon={<CreditCard />} label="Product" value={liveData.product_interest} />
                                <DataRow icon={<IndianRupee />} label="Loan Amt" value={liveData.loan_amount_range} />
                                <DataRow icon={<Clock />} label="Timeline" value={liveData.timeline} />
                            </div>
                        </div>

                        {/* Saved Agent Data: Call History */}
                        <div className="glass rounded-2xl p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-xl font-semibold flex items-center gap-2">
                                    <Phone className="w-5 h-5 text-purple-400" /> Call History
                                    <span className="text-sm font-normal text-indigo-300">({history.length} leads)</span>
                                </h2>
                                <button onClick={fetchHistory} className="flex items-center gap-2 text-sm text-indigo-300 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/10">
                                    <RefreshCw className={`w-4 h-4 ${historyLoading ? 'animate-spin' : ''}`} /> Refresh
                                </button>
                            </div>
                            {history.length === 0 ? (
                                <div className="text-center py-12 text-indigo-200/40 italic">No leads saved yet. Complete a call to see it here.</div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="text-indigo-300 border-b border-white/10">
                                                <th className="text-left py-3 px-3 font-medium">Name</th>
                                                <th className="text-left py-3 px-3 font-medium">Phone</th>
                                                <th className="text-left py-3 px-3 font-medium">Location</th>
                                                <th className="text-left py-3 px-3 font-medium">Product</th>
                                                <th className="text-left py-3 px-3 font-medium">Loan Amt</th>
                                                <th className="text-left py-3 px-3 font-medium">Income</th>
                                                <th className="text-left py-3 px-3 font-medium">Date</th>
                                                <th className="text-left py-3 px-3 font-medium"></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {history.map((lead, idx) => {
                                                const rowId = lead.id || lead.callSid || String(idx);
                                                const isExpanded = expandedRow === rowId;
                                                const date = lead.createdAt || lead.timestamp;
                                                return (
                                                    <React.Fragment key={rowId}>
                                                        <tr className="border-b border-white/5 hover:bg-white/5 cursor-pointer" onClick={() => setExpandedRow(isExpanded ? null : rowId)}>
                                                            <td className="py-3 px-3 font-medium text-white">{lead.full_name || '—'}</td>
                                                            <td className="py-3 px-3 text-indigo-200">{lead.phone || '—'}</td>
                                                            <td className="py-3 px-3 text-indigo-200">{lead.city ? `${lead.city}${lead.pincode ? ` (${lead.pincode})` : ''}` : '—'}</td>
                                                            <td className="py-3 px-3"><span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-200 text-xs">{lead.product_interest || '—'}</span></td>
                                                            <td className="py-3 px-3 text-indigo-200">{lead.loan_amount_range || '—'}</td>
                                                            <td className="py-3 px-3 text-indigo-200">{lead.monthly_income || '—'}</td>
                                                            <td className="py-3 px-3 text-indigo-300 text-xs">{date ? new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                                                            <td className="py-3 px-3">{isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</td>
                                                        </tr>
                                                        {isExpanded && (
                                                            <tr className="border-b border-white/10 bg-white/5">
                                                                <td colSpan={8} className="px-6 py-4">
                                                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                                                                        <DetailItem label="Employment" value={lead.employment_type} />
                                                                        <DetailItem label="Timeline" value={lead.timeline} />
                                                                        <DetailItem label="Callback" value={lead.callback_time} />
                                                                        <DetailItem label="Email" value={lead.email} />
                                                                        <DetailItem label="Call SID" value={lead.callSid?.slice(0, 20) + '...'} />
                                                                        <DetailItem label="Status" value={lead.status} />
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <>
                        {/* RM: Big Direct RM Call (centered) */}
                        <div className="flex justify-center">
                            <div className="glass rounded-2xl p-8 md:p-12 w-full max-w-2xl flex flex-col gap-6">
                                <h2 className="text-2xl font-semibold text-center flex items-center justify-center gap-3">
                                    <PhoneForwarded className="w-8 h-8 text-violet-400" /> Make a Call
                                </h2>
                                <input
                                    type="tel"
                                    placeholder="+91 9876543210"
                                    value={phoneNumber}
                                    onChange={e => setPhoneNumber(e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-lg text-white placeholder-indigo-300/50 focus:outline-none focus:ring-2 focus:ring-violet-400/50"
                                />
                                <button
                                    onClick={handleDirectRMCall}
                                    disabled={callStatus === 'in-progress' || directRMStatus === 'dialing' || !phoneNumber}
                                    className="w-full bg-gradient-to-r from-rose-600 to-orange-500 hover:from-rose-500 hover:to-orange-400 text-white font-bold py-4 px-6 rounded-2xl text-lg shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                                >
                                    {directRMStatus === 'dialing' ? <Loader2 className="w-6 h-6 animate-spin" /> : <PhoneForwarded className="w-6 h-6" />}
                                    Direct RM Call
                                </button>
                                <p className="text-xs text-indigo-300/50 text-center">Skips AI agent — dials customer & RM directly</p>
                            </div>
                        </div>

                        {/* RM Data: Scheduled Callbacks + Recordings */}
                        <div className="glass rounded-2xl p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-xl font-semibold flex items-center gap-2">
                                    <CalendarClock className="w-5 h-5 text-indigo-400" /> Scheduled RM Callbacks
                                    <span className="text-sm font-normal text-indigo-300">({callbacks.length} pending)</span>
                                </h2>
                                <button onClick={fetchCallbacks} className="flex items-center gap-2 text-sm text-indigo-300 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/10">
                                    <RefreshCw className="w-4 h-4" /> Refresh
                                </button>
                            </div>
                            {callbacks.length === 0 ? (
                                <div className="text-center py-10 text-indigo-200/40 italic">No callbacks scheduled yet.</div>
                            ) : (
                                <div className="overflow-x-auto mb-8">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="text-indigo-300 border-b border-white/10">
                                                <th className="text-left py-3 px-3 font-medium">Customer</th>
                                                <th className="text-left py-3 px-3 font-medium">Phone</th>
                                                <th className="text-left py-3 px-3 font-medium">Scheduled For</th>
                                                <th className="text-left py-3 px-3 font-medium">Logged At</th>
                                                <th className="text-left py-3 px-3 font-medium">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {callbacks.map((cb) => (
                                                <tr key={cb.id} className="border-b border-white/5 hover:bg-white/5">
                                                    <td className="py-3 px-3 font-medium text-white">{cb.customerName}</td>
                                                    <td className="py-3 px-3 text-indigo-200">{cb.customerPhone}</td>
                                                    <td className="py-3 px-3"><span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-200 text-xs">{cb.scheduledTime}</span></td>
                                                    <td className="py-3 px-3 text-indigo-300 text-xs">{new Date(cb.scheduledAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                                                    <td className="py-3 px-3"><span className={`px-2 py-0.5 rounded-full text-xs ${cb.status === 'pending' ? 'bg-yellow-500/20 text-yellow-200' : 'bg-green-500/20 text-green-200'}`}>{cb.status}</span></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            <div className="flex items-center justify-between mb-4 pt-4 border-t border-white/10">
                                <h2 className="text-xl font-semibold flex items-center gap-2">
                                    <Mic className="w-5 h-5 text-rose-400" /> Call Recordings
                                    <span className="text-sm font-normal text-indigo-300">({recordings.length})</span>
                                </h2>
                                <button onClick={fetchRecordings} className="flex items-center gap-2 text-sm text-indigo-300 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/10">
                                    <RefreshCw className="w-4 h-4" /> Refresh
                                </button>
                            </div>
                            {recordings.length === 0 ? (
                                <div className="text-center py-10 text-indigo-200/40 italic">RM-customer call recordings will appear here once a call completes.</div>
                            ) : (
                                <div className="space-y-3">
                                    {recordings.map(rec => {
                                        const mins = Math.floor(rec.duration / 60);
                                        const secs = String(rec.duration % 60).padStart(2, '0');
                                        return (
                                            <div key={rec.id} className="flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/5">
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-white font-medium text-sm">{new Date(rec.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                                                    <p className="text-indigo-300 text-xs mt-0.5">Duration: {mins}:{secs} · SID: {rec.id.slice(0, 16)}...</p>
                                                </div>
                                                <audio controls src={`${BACKEND_URL}/api/recordings/${rec.id}/audio`} className="h-8 max-w-[260px]" preload="none" />
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </main>

            {/* Schedule Callback Modal */}
            {showScheduleModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="glass rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-semibold flex items-center gap-2">
                                <CalendarClock className="w-5 h-5 text-indigo-400" /> Schedule RM Callback
                            </h3>
                            <button onClick={() => setShowScheduleModal(false)} className="text-indigo-400 hover:text-white"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm text-indigo-300">When should the RM call back?</label>
                            <input
                                type="text"
                                placeholder='e.g. "tomorrow at 3pm"'
                                value={scheduleTime}
                                onChange={e => setScheduleTime(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-indigo-300/40 focus:outline-none focus:ring-2 focus:ring-indigo-400/50"
                                autoFocus
                            />
                            <p className="text-xs text-indigo-300/50">Customer: {liveData.full_name || 'Unknown'} — {phoneNumber}</p>
                        </div>
                        <div className="flex gap-3">
                            <button onClick={() => setShowScheduleModal(false)} className="flex-1 bg-white/5 hover:bg-white/10 text-indigo-200 font-semibold py-2.5 rounded-xl">Cancel</button>
                            <button onClick={handleScheduleSubmit} disabled={!scheduleTime.trim() || scheduleSubmitting} className="flex-1 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold py-2.5 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                                {scheduleSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />} Confirm
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function DataRow({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string }) {
    return (
        <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5 border border-white/5">
            <div className="flex items-center gap-2 text-indigo-200 text-sm">
                <div className="w-4 h-4 opacity-60">{icon}</div>
                <span>{label}</span>
            </div>
            <div className="font-medium text-white text-sm text-right">
                {value || <span className="text-white/30 italic text-xs">Pending...</span>}
            </div>
        </div>
    );
}

function DetailItem({ label, value }: { label: string; value?: string }) {
    return (
        <div>
            <p className="text-indigo-400 text-xs mb-1">{label}</p>
            <p className="text-white font-medium">{value || <span className="text-white/30 italic">—</span>}</p>
        </div>
    );
}

export default App;
