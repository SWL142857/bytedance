export interface Job {
  jobId: string;
  title: string;
  department: string;
  level: string;
  requirements: string;
  rubric: string;
  status: JobStatus;
  owner: string;
  createdAt: string;
}

export type JobStatus = "open" | "paused" | "closed";
