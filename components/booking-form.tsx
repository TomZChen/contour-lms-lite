"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AvailabilityPicker } from "@/components/availability-picker";
import { apiFetch, ApiClientError, SLOT_ERROR_CODES } from "@/lib/api-client";
import type { ConsultationDto, SubjectDto } from "@/lib/dto";
import { formatDateTime } from "@/lib/format";
import { createConsultationSchema, type CreateConsultationInput } from "@/lib/validation";

type Props = {
  subjects: SubjectDto[];
  defaultFirstName?: string;
  defaultLastName?: string;
};

const FIELD_NAMES = ["firstName", "lastName", "reason", "scheduledAt", "subjectId", "tutorId"] as const;

/**
 * Booking form: subject → tutor (booked-out badges + recommendations) → slot,
 * then the spec's fields (first name, last name, reason). Validated with the
 * same zod schema the API uses (D39).
 */
export function BookingForm({ subjects, defaultFirstName = "", defaultLastName = "" }: Props) {
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);

  const form = useForm<CreateConsultationInput>({
    resolver: zodResolver(createConsultationSchema),
    defaultValues: {
      firstName: defaultFirstName,
      lastName: defaultLastName,
      reason: "",
      subjectId: "",
      tutorId: "",
      scheduledAt: "",
    },
  });
  const { register, control, handleSubmit, setValue, setError, formState } = form;
  const { errors, isSubmitting } = formState;
  const subjectId = useWatch({ control, name: "subjectId" });
  const scheduledAt = useWatch({ control, name: "scheduledAt" });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const created = await apiFetch<ConsultationDto>("/api/consultations", { method: "POST", body: values });
      toast.success(`Booked ${created.subject.name} with ${created.tutor.fullName} on ${formatDateTime(created.scheduledAt)}.`);
      router.push("/student");
      router.refresh();
    } catch (e) {
      if (!(e instanceof ApiClientError)) {
        toast.error("Something went wrong. Please try again.");
        return;
      }
      if (SLOT_ERROR_CODES.has(e.code)) {
        // The slot went stale (someone else booked it): reload availability.
        setValue("scheduledAt", "");
        setError("scheduledAt", { message: e.message });
        setRefreshKey((k) => k + 1);
        return;
      }
      // Surface server-side field errors on the matching inputs.
      const fieldErrors = (e.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors;
      for (const name of FIELD_NAMES) {
        const msg = fieldErrors?.[name]?.[0];
        if (msg) setError(name, { message: msg });
      }
      toast.error(e.message);
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>1. Subject, tutor and time</CardTitle>
          <CardDescription>Consultations are 60 minutes. All times are Melbourne time.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="max-w-sm space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Controller
              control={control}
              name="subjectId"
              render={({ field }) => (
                <Select
                  value={field.value || undefined}
                  onValueChange={(v) => {
                    field.onChange(v);
                    setValue("tutorId", "");
                    setValue("scheduledAt", "");
                  }}
                >
                  <SelectTrigger id="subject" aria-invalid={Boolean(errors.subjectId)}>
                    <SelectValue placeholder="Choose a subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.subjectId && <p className="text-destructive text-sm">Please choose a subject.</p>}
          </div>

          {subjectId && (
            <Controller
              control={control}
              name="tutorId"
              render={({ field: tutorField }) => (
                <Controller
                  control={control}
                  name="scheduledAt"
                  render={({ field: slotField }) => (
                    <AvailabilityPicker
                      key={subjectId}
                      subjectId={subjectId}
                      tutorId={tutorField.value || undefined}
                      scheduledAt={slotField.value || undefined}
                      onTutorChange={tutorField.onChange}
                      onSlotChange={(v) => slotField.onChange(v ?? "")}
                      refreshKey={refreshKey}
                    />
                  )}
                />
              )}
            />
          )}
          {subjectId && (errors.tutorId || errors.scheduledAt) && (
            <p className="text-destructive text-sm">
              {errors.tutorId
                ? "Please choose a tutor and a time."
                : !scheduledAt
                  ? (errors.scheduledAt?.type === "manual" ? errors.scheduledAt.message : "Please choose a time.")
                  : errors.scheduledAt?.message}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Your details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firstName">First name</Label>
            <Input id="firstName" autoComplete="given-name" aria-invalid={Boolean(errors.firstName)} {...register("firstName")} />
            {errors.firstName && <p className="text-destructive text-sm">{errors.firstName.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">Last name</Label>
            <Input id="lastName" autoComplete="family-name" aria-invalid={Boolean(errors.lastName)} {...register("lastName")} />
            {errors.lastName && <p className="text-destructive text-sm">{errors.lastName.message}</p>}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="reason">Reason for consultation</Label>
            <Textarea id="reason" rows={4} maxLength={1000} aria-invalid={Boolean(errors.reason)} {...register("reason")} />
            {errors.reason && <p className="text-destructive text-sm">{errors.reason.message}</p>}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.push("/student")}>Back</Button>
        <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Booking…" : "Book consultation"}</Button>
      </div>
    </form>
  );
}
