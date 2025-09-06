import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  // Fetch sent messages from local database
  const fetchSentMessages = async () => {
    try {
      const response = await createAuthenticatedRequest("/api/messages/sent");
      if (response.ok) {
        const data = await response.json();
        // Sort messages by timestamp descending (newest first)
        const sortedData = data.sort((a: any, b: any) => {
          return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        });
        setSentMessages(sortedData);
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
        // Sort messages by timestamp descending (newest first)
        const sortedData = data.sort((a: any, b: any) => {
          return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        });
        setReceivedMessages(sortedData);
      }
    } catch (error) {
      console.error("Error fetching received messages:", error);
    }
  };

  // Check for new messages from WhatsApp API (based on api.whatsiplus.com sample)
  const checkForNewMessages = async () => {
    try {
      // Get WhatsApp settings to retrieve the API token
      const settingsResponse = await createAuthenticatedRequest("/api/whatsapp-settings");
      if (!settingsResponse.ok) {
        console.log("WhatsApp settings not configured");
        return;
      }
      
      const settings = await settingsResponse.json();
      const apiToken = settings.token;
      const phoneNumber = settings.phoneNumber;

      if (!apiToken || !phoneNumber) {
        console.log("Missing API token or phone number in WhatsApp settings");
        return;
      }

      // Clean phone number (remove + and any non-numeric characters)
      const cleanPhoneNumber = phoneNumber.replace(/[^0-9]/g, '');
      
      // Fetch messages from WhatsApp API (equivalent to Python http.client sample)
      const apiUrl = `https://api.whatsiplus.com/receivedMessages/${apiToken}?page=1&phonenumber=${cleanPhoneNumber}`;
      console.log(`Checking for new messages from: ${apiUrl.replace(apiToken, '[API_KEY]')}`);
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        const apiData = await response.json();
        console.log("WhatsApp API response:", apiData);
        
        // Process and store new messages - handle different possible response formats
        let messages = [];
        if (apiData.messages && Array.isArray(apiData.messages)) {
          messages = apiData.messages;
        } else if (apiData.data && Array.isArray(apiData.data)) {
          messages = apiData.data;
        } else if (Array.isArray(apiData)) {
          messages = apiData;
        }

        if (messages.length > 0) {
          console.log(`Processing ${messages.length} messages from API`);
          
          for (const message of messages) {
            // Check if message already exists using multiple fields for better matching
            const messageText = message.message || message.text || message.body || "";
            const messageSender = message.sender || message.from || message.phone || "Unknown";
            const messageTime = message.timestamp || message.time || message.date || new Date().toISOString();
            
            const exists = receivedMessages.some(existing => 
              existing.sender === messageSender && 
              existing.message === messageText &&
              existing.timestamp && Math.abs(new Date(existing.timestamp).getTime() - new Date(messageTime).getTime()) < 300000 // Within 5 minutes
            );

            if (!exists && messageText.trim()) {
              console.log(`New message found from ${messageSender}: ${messageText.substring(0, 50)}...`);
              
              // Store new message in database
              const postResponse = await createAuthenticatedRequest("/api/messages/received", {
                method: "POST",
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  sender: messageSender,
                  message: messageText,
                  status: "خوانده نشده"
                }),
              });

              if (!postResponse.ok) {
                console.error("Failed to store message:", await postResponse.text());
              }
            }
          }
          
          // Refresh received messages
          await fetchReceivedMessages();
        }
      } else {
        console.error(`WhatsApp API error: ${response.status} - ${response.statusText}`);
        const errorText = await response.text();
        console.error("API Error Response:", errorText);
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

  // Mark all unread messages as read
  const markAllAsRead = async () => {
    setIsMarkingAllRead(true);
    
    try {
      const unreadMessages = receivedMessages.filter(msg => msg.status === "خوانده نشده");
      
      if (unreadMessages.length === 0) {
        toast({
          title: "اطلاع",
          description: "همه پیام‌ها قبلاً خوانده شده‌اند",
        });
        return;
      }

      console.log(`در حال علامت‌گذاری ${unreadMessages.length} پیام به عنوان خوانده شده`);
      
      let successCount = 0;
      let errorCount = 0;

      // Process messages in batches to avoid overwhelming the server
      const batchSize = 5;
      for (let i = 0; i < unreadMessages.length; i += batchSize) {
        const batch = unreadMessages.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (message) => {
          try {
            const response = await createAuthenticatedRequest(`/api/messages/received/${message.id}/read`, {
              method: "PUT",
            });

            if (response.ok) {
              successCount++;
              // Update local state immediately
              setReceivedMessages(prev => 
                prev.map(msg => 
                  msg.id === message.id 
                    ? { ...msg, status: "خوانده شده" }
                    : msg
                )
              );
            } else {
              errorCount++;
              console.error(`خطا در بروزرسانی پیام ${message.id}`);
            }
          } catch (error) {
            errorCount++;
            console.error(`خطا در بروزرسانی پیام ${message.id}:`, error);
          }
        }));

        // Small delay between batches
        if (i + batchSize < unreadMessages.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      if (successCount > 0) {
        toast({
          title: "موفقیت",
          description: `${successCount} پیام به عنوان خوانده شده علامت‌گذاری شد`,
        });
      }

      if (errorCount > 0) {
        toast({
          title: "هشدار",
          description: `${errorCount} پیام بروزرسانی نشد`,
          variant: "destructive",
        });
      }

      console.log(`تکمیل شد: ${successCount} موفق، ${errorCount} خطا`);
      
    } catch (error) {
      console.error("خطا در علامت‌گذاری همه پیام‌ها:", error);
      toast({
        title: "خطا",
        description: "خطا در علامت‌گذاری پیام‌ها",
        variant: "destructive",
      });
    } finally {
      setIsMarkingAllRead(false);
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

  // Set up 5-second refresh for received messages list
  useEffect(() => {
    const interval = setInterval(() => {
      fetchReceivedMessages();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Full sync function - runs in background
  const performFullSync = async () => {
    console.log("شروع همگام‌سازی کامل پیام‌ها...");
    
    try {
      // Get WhatsApp settings
      const settingsResponse = await createAuthenticatedRequest("/api/whatsapp-settings");
      if (!settingsResponse.ok) {
        console.log("تنظیمات WhatsApp موجود نیست");
        return;
      }
      
      const settings = await settingsResponse.json();
      const apiToken = settings.token;
      const phoneNumber = settings.phoneNumber;

      if (!apiToken || !phoneNumber) {
        console.log("API Token یا شماره تلفن موجود نیست");
        return;
      }

      const cleanPhoneNumber = phoneNumber.replace(/[^0-9]/g, '');
      console.log("دریافت پیام‌ها از WhatsApp API...");

      // Get multiple pages of messages for complete history
      const allMessages = [];
      for (let page = 1; page <= 5; page++) { // Get first 5 pages
        const apiUrl = `https://api.whatsiplus.com/receivedMessages/${apiToken}?page=${page}&phonenumber=${cleanPhoneNumber}`;
        
        try {
          const response = await fetch(apiUrl, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          });
          
          if (response.ok) {
            const apiData = await response.json();
            let messages = [];
            
            if (apiData.messages && Array.isArray(apiData.messages)) {
              messages = apiData.messages;
            } else if (apiData.data && Array.isArray(apiData.data)) {
              messages = apiData.data;
            } else if (Array.isArray(apiData)) {
              messages = apiData;
            }

            if (messages.length === 0) {
              console.log(`صفحه ${page}: پیام‌ی یافت نشد`);
              break; // No more messages
            }

            console.log(`صفحه ${page}: ${messages.length} پیام یافت شد`);
            allMessages.push(...messages);
          } else {
            console.log(`خطا در صفحه ${page}: ${response.status}`);
            break;
          }
        } catch (error) {
          console.error(`خطا در درخواست صفحه ${page}:`, error);
          break;
        }

        // Small delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      console.log(`مجموع ${allMessages.length} پیام دریافت شد`);

      if (allMessages.length > 0) {
        // Sort by timestamp (oldest first for proper processing)
        const sortedMessages = allMessages.sort((a, b) => {
          const aTime = new Date(a.timestamp || a.time || a.date || 0).getTime();
          const bTime = new Date(b.timestamp || b.time || b.date || 0).getTime();
          return aTime - bTime;
        });

        let newMessagesCount = 0;
        
        // Process each message
        for (const message of sortedMessages) {
          const messageText = message.message || message.text || message.body || "";
          const messageSender = message.sender || message.from || message.phone || "Unknown";
          const messageTime = message.timestamp || message.time || message.date || new Date().toISOString();
          
          if (messageText.trim()) {
            // Check if message already exists (more relaxed check for full sync)
            const exists = receivedMessages.some(existing => 
              existing.sender === messageSender && 
              existing.message === messageText
            );

            if (!exists) {
              try {
                const dbResponse = await createAuthenticatedRequest("/api/messages/received", {
                  method: "POST",
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    sender: messageSender,
                    message: messageText,
                    status: "خوانده نشده"
                  }),
                });

                if (dbResponse.ok) {
                  newMessagesCount++;
                } else {
                  console.error("خطا در ذخیره پیام:", messageSender);
                }
              } catch (error) {
                console.error("خطا در ذخیره پیام:", error);
              }
            }
          }
        }

        console.log(`${newMessagesCount} پیام جدید در دیتابیس ذخیره شد`);
        
        // Refresh the messages list after sync
        await fetchReceivedMessages();
        console.log("لیست پیام‌ها بروز شد");
        
        toast({
          title: "همگام‌سازی کامل",
          description: `${newMessagesCount} پیام جدید ذخیره شد`,
        });
      } else {
        console.log("هیچ پیام جدیدی یافت نشد");
      }
    } catch (error) {
      console.error("خطا در همگام‌سازی کامل:", error);
    }
  };

  // Run full sync on component mount (in background)
  useEffect(() => {
    // Delay the full sync to avoid blocking initial page load
    const timeout = setTimeout(() => {
      performFullSync();
    }, 3000); // Wait 3 seconds after page load
    
    return () => clearTimeout(timeout);
  }, []);

  const formatTimestamp = (timestamp: Date | string | null) => {
    if (!timestamp) return 'تاریخ نامشخص';
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
                      className="p-4 border rounded-lg hover:bg-gray-50 transition-colors text-right"
                      dir="rtl"
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
                      <div className="text-xs text-muted-foreground">
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
            <div className="flex justify-between items-center">
              <CardTitle className="flex items-center">
                <Inbox className="w-5 h-5 ml-2" />
                گزارشات دریافتی
              </CardTitle>
              <div className="flex items-center space-x-2">
                {receivedMessages.some(msg => msg.status === "خوانده نشده") && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={markAllAsRead}
                    disabled={isMarkingAllRead}
                    className="text-sm"
                  >
                    {isMarkingAllRead ? "در حال بروزرسانی..." : "همه را خوانده شده علامت‌گذاری کن"}
                  </Button>
                )}
              </div>
            </div>
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
                      className={`p-4 border rounded-lg cursor-pointer transition-colors text-right ${
                        message.status === "خوانده نشده" 
                          ? "bg-green-100 hover:bg-green-200" 
                          : "hover:bg-gray-50"
                      }`}
                      dir="rtl"
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
                      <div className="text-xs text-muted-foreground">
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