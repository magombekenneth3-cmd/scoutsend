"use client";

import {
    useState,
    useEffect,
    useCallback,
    useRef,
    useTransition,
} from "react";
import {
    brandApi,
    SAFE_FONT_STACKS,
    type BrandSettings,
    type BrandSettingsInput,
} from "./brand.api";

const DEFAULT_FORM: BrandSettingsInput = {
    companyName: "",
    website: null,
    tagline: null,
    logoUrl: null,
    primaryColour: "#1a1a2e",
    secondaryColour: "#e94560",
    accentColour: null,
    textColour: "#333333",
    backgroundColour: "#ffffff",
    fontFamily: SAFE_FONT_STACKS[0],
    senderName: "",
    senderTitle: null,
    senderPhone: null,
    companyAddress: null,
    unsubscribeText:
        "You received this email because you match our ideal customer profile. To unsubscribe, reply with 'unsubscribe'.",
    facebookUrl: null,
    linkedinUrl: null,
    twitterUrl: null,
};

const AUTO_SAVE_DELAY_MS = 2500;
const SAVE_SUCCESS_DISPLAY_MS = 4000;
const HEX_COLOUR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const URL_RE = /^https?:\/\/.+/;

function settingsToForm(s: BrandSettings): BrandSettingsInput {
    return {
        companyName: s.companyName ?? "",
        website: s.website ?? null,
        tagline: s.tagline ?? null,
        logoUrl: s.logoUrl ?? null,
        primaryColour: s.primaryColour ?? "#1a1a2e",
        secondaryColour: s.secondaryColour ?? "#e94560",
        accentColour: s.accentColour ?? null,
        textColour: s.textColour ?? "#333333",
        backgroundColour: s.backgroundColour ?? "#ffffff",
        fontFamily: s.fontFamily ?? SAFE_FONT_STACKS[0],
        senderName: s.senderName ?? "",
        senderTitle: s.senderTitle ?? null,
        senderPhone: s.senderPhone ?? null,
        companyAddress: s.companyAddress ?? null,
        unsubscribeText:
            s.unsubscribeText ??
            "You received this email because you match our ideal customer profile. To unsubscribe, reply with 'unsubscribe'.",
        facebookUrl: s.facebookUrl ?? null,
        linkedinUrl: s.linkedinUrl ?? null,
        twitterUrl: s.twitterUrl ?? null,
    };
}

function validateForm(form: BrandSettingsInput): Record<string, string> {
    const errors: Record<string, string> = {};

    if (!(form.companyName ?? "").trim()) errors.companyName = "Company name is required";
    if (!(form.senderName ?? "").trim()) errors.senderName = "Sender name is required";

    if (!HEX_COLOUR_RE.test(form.primaryColour)) errors.primaryColour = "Invalid hex colour";
    if (!HEX_COLOUR_RE.test(form.secondaryColour)) errors.secondaryColour = "Invalid hex colour";
    if (!HEX_COLOUR_RE.test(form.textColour)) errors.textColour = "Invalid hex colour";
    if (!HEX_COLOUR_RE.test(form.backgroundColour)) errors.backgroundColour = "Invalid hex colour";
    if (form.accentColour && !HEX_COLOUR_RE.test(form.accentColour))
        errors.accentColour = "Invalid hex colour";

    if (form.website && !URL_RE.test(form.website)) errors.website = "Must start with http(s)://";
    if (form.logoUrl && !URL_RE.test(form.logoUrl)) errors.logoUrl = "Must start with http(s)://";
    if (form.linkedinUrl && !URL_RE.test(form.linkedinUrl))
        errors.linkedinUrl = "Must start with http(s)://";
    if (form.facebookUrl && !URL_RE.test(form.facebookUrl))
        errors.facebookUrl = "Must start with http(s)://";
    if (form.twitterUrl && !URL_RE.test(form.twitterUrl))
        errors.twitterUrl = "Must start with http(s)://";

    return errors;
}

export function useBrand() {
    const [form, setForm] = useState<BrandSettingsInput>(DEFAULT_FORM);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [loadingInitial, setLoadingInitial] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [configured, setConfigured] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [isSaving, startSave] = useTransition();
    const [previewKey, setPreviewKey] = useState(0);

    const formRef = useRef<BrandSettingsInput>(DEFAULT_FORM);
    const savedRef = useRef<BrandSettingsInput | null>(null);
    const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const savingRef = useRef(false);
    const pendingTargetRef = useRef<BrandSettingsInput | null>(null);
    const hasEditedRef = useRef(false);
    const isMountedRef = useRef(true);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
        };
    }, []);

    useEffect(() => {
        brandApi
            .getSettings()
            .then((res) => {
                if (!isMountedRef.current) return;
                const { data, configured: c } = res;
                const hasData = !!data && Object.keys(data).length > 0;

                if (!hasEditedRef.current) {
                    const f = hasData ? settingsToForm(data) : DEFAULT_FORM;
                    formRef.current = f;
                    setForm(f);
                    savedRef.current = hasData ? f : null;
                }
                setConfigured(hasData ? c : false);
            })
            .catch((e) => {
                if (!isMountedRef.current) return;
                setLoadError(e instanceof Error ? e.message : "Failed to load brand settings");
            })
            .finally(() => {
                if (isMountedRef.current) setLoadingInitial(false);
            });
    }, []);

    const runSave = useCallback((target: BrandSettingsInput) => {
        savingRef.current = true;
        setErrors({});
        setSaveError(null);
        setSaveSuccess(false);

        startSave(async () => {
            try {
                await brandApi.upsert(target);
                if (!isMountedRef.current) return;
                savedRef.current = target;
                setIsDirty(JSON.stringify(formRef.current) !== JSON.stringify(target));
                setConfigured(true);
                setSaveSuccess(true);
                setPreviewKey((k) => k + 1);
                setTimeout(() => {
                    if (isMountedRef.current) setSaveSuccess(false);
                }, SAVE_SUCCESS_DISPLAY_MS);
            } catch (e) {
                if (isMountedRef.current) {
                    setSaveError(e instanceof Error ? e.message : "Save failed");
                }
            } finally {
                savingRef.current = false;
                const pending = pendingTargetRef.current;
                pendingTargetRef.current = null;
                if (pending) runSave(pending);
            }
        });
    }, []);

    const save = useCallback(
        (formOverride?: BrandSettingsInput) => {
            const target = formOverride ?? formRef.current;
            const errs = validateForm(target);
            if (Object.keys(errs).length > 0) {
                setErrors(errs);
                return;
            }

            if (autoSaveTimer.current) {
                clearTimeout(autoSaveTimer.current);
                autoSaveTimer.current = null;
            }

            if (savingRef.current) {
                pendingTargetRef.current = target;
                return;
            }

            runSave(target);
        },
        [runSave]
    );

    const scheduleAutoSave = useCallback(
        (latest: BrandSettingsInput) => {
            if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
            autoSaveTimer.current = setTimeout(() => {
                autoSaveTimer.current = null;
                const errs = validateForm(latest);
                if (Object.keys(errs).length > 0) return;
                save(latest);
            }, AUTO_SAVE_DELAY_MS);
        },
        [save]
    );

    const updateField = useCallback(
        <K extends keyof BrandSettingsInput>(key: K, value: BrandSettingsInput[K]) => {
            hasEditedRef.current = true;

            const next = { ...formRef.current, [key]: value };
            formRef.current = next;
            setForm(next);

            const dirty = JSON.stringify(next) !== JSON.stringify(savedRef.current);
            setIsDirty(dirty);
            setSaveSuccess(false);

            setErrors((prev) => {
                if (!prev[key]) return prev;
                const rest = { ...prev };
                delete rest[key];
                return rest;
            });

            if (dirty) {
                scheduleAutoSave(next);
            } else if (autoSaveTimer.current) {
                clearTimeout(autoSaveTimer.current);
                autoSaveTimer.current = null;
            }
        },
        [scheduleAutoSave]
    );

    return {
        form,
        errors,
        updateField,
        save,
        isSaving,
        saveSuccess,
        saveError,
        loadingInitial,
        loadError,
        configured,
        isDirty,
        previewKey,
    };
}