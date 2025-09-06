import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, Send, Inbox, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { createAuthenticatedRequest } from "@/lib/auth";
import type { SentMessage, ReceivedMessage } from "@shared/schema";

export default function Reports() {
  const [sentMessages, setSentMessages] = useState<SentMessage[]>([]);
  const [receivedMessages, setReceivedMessages] = useState<ReceivedMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { user } = useAuth();
  const { toast } = useToast();

  // Fetch sent messages from local database
  const fetchSentMessages = async () => {
    try {
      const response = await createAuthenticatedRequest("/api/messages/sent");
      if (response.ok) {
        const data = await response.json();
        setSentMessages(data);
      }
    } catch (error) {
      console.error("Error fetching sent messages:", error);
    }
  };

  // Fetch received messages from local database
  const fetchReceivedMessages = async () => {
    try {
      const response = await createAuthenticatedRequest("/api/messages/received");
      if (response.ok) {
        const data = await response.json();
        setReceivedMessages(data);
      }
    } catch (error) {
      console.error("Error fetching received messages:", error);
    }
  };

  // Check for new messages from WhatsApp API
  const checkForNewMessages = async () => {
    try {
      // Get WhatsApp settings to retrieve the API token
      const settingsResponse = await createAuthenticatedRequest("/api/whatsapp-settings");
      if (!settingsResponse.ok) return;
      
      const settings = await settingsResponse.json();
      const apiToken = settings.token;
      const phoneNumber = settings.phoneNumber;

      if (!apiToken || !phoneNumber) return;

      // Fetch messages from WhatsApp API
      const apiUrl = `https://api.whatsiplus.com/receivedMessages/${apiToken}?page=1&phonenumber=${phoneNumber.replace('+', '')}`;
      const response = await fetch(apiUrl);
      
      if (response.ok) {
        const apiData = await response.json();
        
        // Process and store new messages
        if (apiData.messages && Array.isArray(apiData.messages)) {
          for (const message of apiData.messages) {
            // Check if message already exists
            const exists = receivedMessages.some(existing => 
              existing.sender === message.sender && 
              existing.message === message.message &&
              Math.abs(new Date(existing.timestamp).getTime() - new Date(message.timestamp).getTime()) < 60000 // Within 1 minute
            );

            if (!exists) {
              // Store new message in database
              await createAuthenticatedRequest("/api/messages/received", {
                method: "POST",
                body: JSON.stringify({
                  sender: message.sender || message.from || "Unknown",
                  message: message.message || message.text || "",
                  status: "خوانده نشده"
                }),
              });
            }
          }
          
          // Refresh received messages
          await fetchReceivedMessages();
        }
      }
    } catch (error) {
      console.error("Error checking for new messages:", error);
    }
  };

  // Handle clicking on a received message to mark as read
  const handleMessageClick = async (messageId: string) => {
    try {
      const response = await createAuthenticatedRequest(`/api/messages/received/${messageId}/read`, {
        method: "PUT",
      });

      if (response.ok) {
        // Update local state
        setReceivedMessages(prev => 
          prev.map(msg => 
            msg.id === messageId 
              ? { ...msg, status: "خوانده شده" }
              : msg
          )
        );
      }
    } catch (error) {
      console.error("Error updating message status:", error);
      toast({
        title: "خطا",
        description: "خطا در بروزرسانی وضعیت پیام",
        variant: "destructive",
      });
    }
  };

  // Initial data fetch
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      await Promise.all([fetchSentMessages(), fetchReceivedMessages()]);
      setIsLoading(false);
    };

    fetchData();
  }, []);

  // Set up 5-second polling for new messages
  useEffect(() => {
    const interval = setInterval(checkForNewMessages, 5000);
    return () => clearInterval(interval);
  }, [receivedMessages]);

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString('fa-IR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "sent":
      case "خوانده شده":
        return "default";
      case "delivered":
        return "secondary";
      case "failed":
        return "destructive";
      case "خوانده نشده":
        return "secondary";
      default:
        return "default";
    }
  };

  if (isLoading) {
    return (
      <DashboardLayout title="گزارشات">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="text-lg">در حال بارگذاری...</div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="گزارشات">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-testid="page-reports">
        
        {/* Right Column - Sent Messages */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Send className="w-5 h-5 ml-2" />
              گزارشات ارسالی
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[600px]">
              {sentMessages.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>هیچ پیام ارسالی یافت نشد</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {sentMessages.map((message) => (
                    <div 
                      key={message.id}
                      className="p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-medium text-sm">گیرنده: {message.recipient}</div>
                        <Badge variant={getStatusBadgeVariant(message.status)}>
                          {message.status}
                        </Badge>
                      </div>
                      <div className="text-gray-700 mb-2 text-sm">
                        {message.message}
                      </div>
                      <div className="flex items-center text-xs text-muted-foreground">
                        <Clock className="w-3 h-3 ml-1" />
                        {formatTimestamp(message.timestamp)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Left Column - Received Messages */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Inbox className="w-5 h-5 ml-2" />
              گزارشات دریافتی
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[600px]">
              {receivedMessages.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>هیچ پیام دریافتی یافت نشد</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {receivedMessages.map((message) => (
                    <div 
                      key={message.id}
                      className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                        message.status === "خوانده نشده" 
                          ? "bg-green-100 hover:bg-green-200" 
                          : "hover:bg-gray-50"
                      }`}
                      onClick={() => handleMessageClick(message.id)}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-medium text-sm">فرستنده: {message.sender}</div>
                        <Badge variant={getStatusBadgeVariant(message.status)}>
                          {message.status}
                        </Badge>
                      </div>
                      <div className="text-gray-700 mb-2 text-sm">
                        {message.message}
                      </div>
                      <div className="flex items-center text-xs text-muted-foreground">
                        <Clock className="w-3 h-3 ml-1" />
                        {formatTimestamp(message.timestamp)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}